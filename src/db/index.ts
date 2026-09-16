import { pgConnectionConfig } from '@/lib/pg-url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

/**
 * The app talks to PlanetScale Postgres over a pooled `pg` connection. A
 * single `Pool` is created once at module scope and reused across requests in
 * the Next.js `nodejs` runtime, so every query reuses a warm connection instead
 * of opening a new one.
 *
 * There are two of them, because everything the pages do is a `SELECT` and only
 * the hourly sync writes. `DATABASE_URL_UNPOOLED` can therefore be a role with
 * nothing but `SELECT` on `items`, which is what a deployment reachable from the
 * internet runs as. The sync reaches for `DATABASE_URL_SYNC` instead, and if that
 * is unset it simply has no database to write to — the corpus goes stale, and
 * nothing that can reach the web holds a credential that can change it.
 */
function databaseUrl(): string {
  const url = process.env.DATABASE_URL_UNPOOLED
  if (!url) throw new Error('Set DATABASE_URL_UNPOOLED to a PlanetScale Postgres connection string.')
  return url
}

type Row = Record<string, unknown>

/**
 * A ceiling on any single statement, set once per connection so it costs
 * nothing per query. It sits clear of the slowest thing the app legitimately
 * asks for, which is prefix-matching a common stem across the comment corpus at
 * a few seconds. This is a guard against a pathological query holding one of the
 * eight connections open, not a tuning knob.
 */
const STATEMENT_TIMEOUT_MS = 15_000

/**
 * Opened on first query, not at import. Every route is dynamic, so a build
 * renders nothing and needs no database — but it does import each route to read
 * its config, and connecting at module scope would make the build demand
 * production credentials it has no use for.
 */
let readPool: Pool | null = null

function pool(): Pool {
  readPool ??= new Pool({ ...pgConnectionConfig(databaseUrl()), max: 8, statement_timeout: STATEMENT_TIMEOUT_MS })
  return readPool
}

/** Postgres raises this when `statement_timeout` cancels a statement. */
const QUERY_CANCELED = '57014'

export function isTimeout(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === QUERY_CANCELED
}

export const sql = {
  query: async (text: string, values?: unknown[]): Promise<Row[]> => {
    const result = await pool().query(text, values)
    return result.rows
  },
}

/** Whether a writable credential is configured for the sync to use. */
export function syncConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL_SYNC)
}

/**
 * A pool for the hourly sync, opened on first use so a deployment that never
 * syncs never holds a writable connection. The sync runs for minutes at a time
 * against a handful of connections, so it gets its own small pool and none of
 * the read pool's statement ceiling.
 */
let writePool: Pool | null = null

export const writeSql = {
  query: async (text: string, values?: unknown[]): Promise<Row[]> => {
    const url = process.env.DATABASE_URL_SYNC
    if (!url) throw new Error('Set DATABASE_URL_SYNC to a role that may write to items.')
    writePool ??= new Pool({ ...pgConnectionConfig(url), max: 4 })
    const result = await writePool.query(text, values)
    return result.rows
  },
}

/** Kept for schema-typed access and future ORM use; migrations read `schema` directly. */
let orm: ReturnType<typeof drizzle> | null = null

export function db() {
  orm ??= drizzle(pool(), { schema })
  return orm
}

export type Timed<T> = { rows: T; ms: number }

/** Runs `fn` and reports how long it took, so the UI can show live query latency. */
export async function timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const started = performance.now()
  const rows = await fn()
  return { rows, ms: performance.now() - started }
}
