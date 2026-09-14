/**
 * Live sync of Hacker News into the `items` table via the official Firebase API.
 *
 * The seed dump stops around late 2021 (id ~28.7M) while HN is well past 49M, so
 * a plain forward cursor would replay years of old content before anything
 * current appeared. Two modes solve that:
 *
 *   - `latest`   (the cron default) refreshes the newest window ending at the
 *     current max item id, so today's stories and comments show up immediately
 *     and their scores / comment counts stay fresh.
 *   - `backfill` walks a separate cursor forward from wherever the seed ended,
 *     closing the historical gap a batch at a time across many runs.
 *
 * Each run is bounded by a wall-clock budget: it fetches ids concurrently in
 * groups, upserts them, and stops cleanly at the deadline after persisting its
 * cursor, so the next invocation resumes where this one left off.
 */

import { sql } from '@/db'
import { ITEM_TYPES, type ItemType } from '@/db/schema'
import pLimit from 'p-limit'

const HN_API = 'https://hacker-news.firebaseio.com/v0'
const ALLOWED = new Set<string>(ITEM_TYPES)

/** How many of the newest ids to re-fetch each `latest` run so scores stay fresh. */
const REFRESH_WINDOW = 2000
/** Ids fetched (and upserted) per group before the deadline is re-checked. */
const GROUP_SIZE = 1000
/** Rows per INSERT statement. 15 columns keeps this far under the 65535 param cap. */
const DB_CHUNK = 500

export type SyncMode = 'latest' | 'backfill'

export type SyncOptions = {
  mode?: SyncMode
  /** Max ids to consider in this run. */
  batch?: number
  /** Concurrent HN item fetches. */
  concurrency?: number
  /** Override the start id (useful for one-off manual backfills). */
  from?: number
  /** Wall-clock budget for the whole run. */
  budgetMs?: number
}

export type SyncResult = {
  mode: SyncMode
  maxItem: number
  range: { start: number; end: number } | null
  fetched: number
  upserted: number
  cursor: number
  timedOut: boolean
  ms: number
}

type HnItem = {
  id: number
  deleted?: boolean
  type?: string
  by?: string
  time?: number
  text?: string
  dead?: boolean
  parent?: number
  poll?: number
  kids?: number[]
  url?: string
  score?: number
  title?: string
  parts?: number[]
  descendants?: number
}

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as T
    } catch {
      if (attempt === 1) return null
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

async function hnMaxItem(): Promise<number> {
  const max = await fetchJson<number>(`${HN_API}/maxitem.json`)
  if (!max || !Number.isFinite(max)) throw new Error('Could not read HN maxitem')
  return max
}

const hnItem = (id: number) => fetchJson<HnItem>(`${HN_API}/item/${id}.json`)

function pgArray(values: number[] | undefined): string {
  if (!values?.length) return '{}'
  return `{${values.filter((n) => Number.isFinite(n)).join(',')}}`
}

/** Map an HN item to a row tuple, or null for anything the table cannot hold. */
function toRow(raw: HnItem | null): unknown[] | null {
  if (!raw || !Number.isFinite(raw.id) || !raw.type || !ALLOWED.has(raw.type)) return null
  return [
    raw.id,
    Boolean(raw.deleted),
    raw.type as ItemType,
    raw.by ?? null,
    typeof raw.time === 'number' ? new Date(raw.time * 1000).toISOString() : null,
    raw.text ?? null,
    Boolean(raw.dead),
    Number.isFinite(raw.parent) ? raw.parent : null,
    Number.isFinite(raw.poll) ? raw.poll : null,
    pgArray(raw.kids),
    raw.url ?? null,
    Number.isFinite(raw.score) ? raw.score : null,
    raw.title ?? null,
    pgArray(raw.parts),
    Number.isFinite(raw.descendants) ? raw.descendants : null,
  ]
}

const COLS = ['id', 'deleted', 'type', '"by"', 'time', 'text', 'dead', 'parent', 'poll', 'kids', 'url', 'score', 'title', 'parts', 'descendants']
// Positional casts for columns the text protocol will not infer on its own.
const CASTS: Record<number, string> = { 4: '::timestamptz', 9: '::bigint[]', 13: '::bigint[]' }
const UPDATE_SET = COLS.filter((c) => c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c === '"by"' ? '"by"' : c}`)
  .join(', ')

/** Upsert a chunk of rows in a single parameterized statement. `search_tsv` is a
 *  generated column, so it recomputes automatically on both insert and update. */
async function upsertChunk(rows: unknown[][]): Promise<number> {
  if (!rows.length) return 0
  const values: unknown[] = []
  const tuples = rows.map((row) => {
    const placeholders = row.map((value, col) => {
      values.push(value)
      return `$${values.length}${CASTS[col] ?? ''}`
    })
    return `(${placeholders.join(', ')})`
  })
  const text = `INSERT INTO items (${COLS.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT (id) DO UPDATE SET ${UPDATE_SET}`
  await sql.query(text, values)
  return rows.length
}

async function ensureStateTable(): Promise<void> {
  await sql.query(`CREATE TABLE IF NOT EXISTS sync_state (
    key text PRIMARY KEY,
    last_id bigint NOT NULL DEFAULT 0,
    synced integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`)
}

async function getCursor(key: string): Promise<number> {
  const rows = (await sql.query('SELECT last_id::text AS last_id FROM sync_state WHERE key = $1', [key])) as Array<{ last_id: string }>
  return rows.length ? Number(rows[0].last_id) : 0
}

async function setCursor(key: string, lastId: number, synced: number): Promise<void> {
  await sql.query(
    `INSERT INTO sync_state (key, last_id, synced, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET last_id = EXCLUDED.last_id, synced = EXCLUDED.synced, updated_at = now()`,
    [key, lastId, synced],
  )
}

async function dbMaxId(): Promise<number> {
  const rows = (await sql.query('SELECT COALESCE(MAX(id), 0)::text AS m FROM items')) as Array<{ m: string }>
  return Number(rows[0].m)
}

/** Resolve the [start, end] id range this run should cover for the given mode. */
async function resolveRange(mode: SyncMode, maxItem: number, batch: number, from: number | undefined): Promise<{ start: number; end: number }> {
  if (mode === 'backfill') {
    const cursor = (await getCursor('backfill')) || (await dbMaxId())
    const start = from ?? cursor + 1
    return { start, end: Math.min(start + batch - 1, maxItem) }
  }
  // latest: cover everything new since the last run plus a refresh overlap,
  // never spanning more than `batch` ids and always ending at the current head.
  const prevMax = await getCursor('latest')
  const desiredStart = from ?? (prevMax > 0 ? Math.min(prevMax + 1, maxItem - REFRESH_WINDOW + 1) : maxItem - batch + 1)
  const start = Math.max(1, desiredStart, maxItem - batch + 1)
  return { start, end: maxItem }
}

export async function syncHn(opts: SyncOptions = {}): Promise<SyncResult> {
  const started = Date.now()
  const mode: SyncMode = opts.mode === 'backfill' ? 'backfill' : 'latest'
  const batch = Math.max(1, opts.batch ?? 10000)
  const concurrency = Math.max(1, Math.min(128, opts.concurrency ?? 64))
  const budgetMs = Math.max(5000, opts.budgetMs ?? 285000)
  const deadline = started + budgetMs

  await ensureStateTable()
  const maxItem = await hnMaxItem()
  const { start, end } = await resolveRange(mode, maxItem, batch, opts.from)

  if (start > end) {
    return { mode, maxItem, range: null, fetched: 0, upserted: 0, cursor: mode === 'backfill' ? await getCursor('backfill') : maxItem, timedOut: false, ms: Date.now() - started }
  }

  // Build the id list, newest-first for `latest` (so the freshest ids win if we
  // run out of time) and oldest-first for `backfill` (so the cursor advances
  // over a contiguous, gap-free range).
  const ids: number[] = []
  for (let id = start; id <= end; id++) ids.push(id)
  if (mode === 'latest') ids.reverse()

  const limit = pLimit(concurrency)
  let fetched = 0
  let upserted = 0
  let processedMaxId = mode === 'backfill' ? start - 1 : maxItem
  let timedOut = false

  for (let i = 0; i < ids.length; i += GROUP_SIZE) {
    if (Date.now() > deadline) {
      timedOut = true
      break
    }
    const group = ids.slice(i, i + GROUP_SIZE)
    const items = await Promise.all(group.map((id) => limit(() => hnItem(id))))
    fetched += items.filter(Boolean).length
    const rows = items.map(toRow).filter((r): r is unknown[] => r !== null)
    for (let j = 0; j < rows.length; j += DB_CHUNK) {
      upserted += await upsertChunk(rows.slice(j, j + DB_CHUNK))
    }
    // For backfill, groups are ascending and contiguous, so the last id in the
    // group is the safe high-water mark to persist.
    if (mode === 'backfill') processedMaxId = group[group.length - 1]
  }

  const cursor = processedMaxId
  await setCursor(mode, cursor, upserted)

  return { mode, maxItem, range: { start, end }, fetched, upserted, cursor, timedOut, ms: Date.now() - started }
}
