import { sql, timed } from '@/db'
import { ITEM_TYPES, type ItemType } from '@/db/schema'
import { COUNT_CAP, MAX_CANDIDATES, PAGE_SIZE, sinceCutoff, type SearchFilters } from '@/lib/search-params'

/**
 * Each item type has its own partial `lakebase_bm25` index whose predicate
 * matches the `WHERE` below. Ranking and counting therefore happen over the
 * requested type only. The single shared index would rank all five types
 * together and, because it scores just its top `default_limit` candidates,
 * silently drop most stories/jobs before the type filter ran.
 */
const PARTIAL_BM25: Partial<Record<ItemType, string>> = {
  story: 'items_story_bm25',
  comment: 'items_comment_bm25',
  job: 'items_job_bm25',
}
/** Covers `all` and the long-tail types (poll, pollopt) that have no partial index. */
const FULL_BM25 = 'items_search_bm25'

export type ItemRecord = {
  id: number
  type: string
  by: string | null
  time: string | null
  url: string | null
  score: number | null
  title: string | null
  descendants: number | null
  parent: number | null
}

export type SearchHit = ItemRecord & { snippet: string | null }
export type ThreadItem = ItemRecord & { text: string | null; deleted: boolean; dead: boolean }

export type MatchCount = { count: number | null; capped: boolean; estimate: number | null; ms: number }

type Row = Record<string, unknown>

function push(values: unknown[], value: unknown): string {
  values.push(value)
  return `$${values.length}`
}

function asInt(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function asHit(row: Row): SearchHit {
  return {
    id: asInt(row.id) ?? 0,
    type: String(row.type ?? ''),
    by: (row.by as string | null) ?? null,
    time: (row.time as string | null) ?? null,
    url: (row.url as string | null) ?? null,
    score: asInt(row.score),
    title: (row.title as string | null) ?? null,
    descendants: asInt(row.descendants),
    parent: asInt(row.parent),
    snippet: (row.snippet as string | null) ?? null,
  }
}

function asThread(row: Row): ThreadItem {
  return {
    ...asHit(row),
    text: (row.text as string | null) ?? null,
    deleted: Boolean(row.deleted),
    dead: Boolean(row.dead),
  }
}

function hitColumns(withSnippet: boolean): string {
  const snippet = withSnippet ? `left(regexp_replace(coalesce(text, ''), '<[^>]+>', ' ', 'g'), 240) AS snippet` : `NULL::text AS snippet`
  return `id, type, "by", time, url, score, title, descendants, parent, ${snippet}`
}

const THREAD_COLUMNS = `id, type, "by", time, url, score, title, text, descendants, parent, deleted, dead`

type Filter = {
  where: string
  values: unknown[]
  q: string
  /** Non-null when the query is full-text: the BM25 index that ranks this type. */
  bm25Index: string | null
  /** `by`/`since` are not baked into the partial indexes, so they need extra scoring headroom. */
  hasResidualFilter: boolean
}

function buildFilter(filters: SearchFilters): Filter {
  const values: unknown[] = []
  const clauses = ['NOT deleted', 'NOT dead']
  const q = filters.q ?? ''
  const type = filters.type

  // A validated literal (never user text) so the planner can match the partial index predicate.
  if (type !== 'all' && (ITEM_TYPES as readonly string[]).includes(type)) {
    clauses.push(`type = '${type}'`)
  }
  if (filters.by) clauses.push(`"by" = ${push(values, filters.by)}`)
  const cutoff = sinceCutoff(filters.since)
  if (cutoff) clauses.push(`time >= ${push(values, cutoff.toISOString())}::timestamptz`)

  let bm25Index: string | null = null
  if (q.length > 0 && q.length <= 2) {
    const prefix = `${q}%`
    clauses.push(`(title ILIKE ${push(values, prefix)} OR "by" ILIKE ${push(values, prefix)})`)
  } else if (q.length > 2) {
    // websearch syntax supports "quoted phrases", -negation and OR from the box.
    clauses.push(`search_tsv @@ websearch_to_tsquery('english', ${push(values, q)})`)
    bm25Index = (type !== 'all' && PARTIAL_BM25[type as ItemType]) || FULL_BM25
  } else if (type !== 'comment') {
    clauses.push(`title IS NOT NULL AND title <> ''`)
  }

  return { where: `WHERE ${clauses.join(' AND ')}`, values, q, bm25Index, hasResidualFilter: Boolean(filters.by) || Boolean(cutoff) }
}

/** BM25 relevance ordering; pushes the query text used to build the query vector. */
function bm25Order(q: string, index: string, values: unknown[]): string {
  return `search_tsv <@> to_bm25query(to_tsvector('english', ${push(values, q)}), '${index}')`
}

/** Chronological / points ordering, matching the btree index directions (time DESC is NULLS FIRST). */
function plainOrder(sort: SearchFilters['sort']): string {
  return sort === 'score' ? 'score DESC NULLS LAST, time DESC' : 'time DESC'
}

/**
 * How many candidates the BM25 index should score. It must cover the page being
 * read (`offset + PAGE_SIZE`); when residual `by`/`since` filters run after the
 * index it is opened to the cap so enough survivors remain.
 */
function candidateLimit(offset: number, hasResidualFilter: boolean): number {
  if (hasResidualFilter) return MAX_CANDIDATES
  return Math.min(MAX_CANDIDATES, offset + PAGE_SIZE + 30)
}

/**
 * Runs `text`. When a BM25 limit is supplied it wraps the statement in a
 * transaction that first sets `lakebase_bm25.default_limit`. SET cannot be
 * parameterized, so `limit` is interpolated (always a computed integer).
 */
async function run(limit: number | null, text: string, values: unknown[]): Promise<Row[]> {
  if (limit == null) return (await sql.query(text, values)) as Row[]
  const result = (await sql.transaction([sql.query(`SET LOCAL lakebase_bm25.default_limit = ${limit | 0}`), sql.query(text, values)])) as unknown[]
  return result[1] as Row[]
}

export async function searchItems(filters: SearchFilters, page: number) {
  const offset = (page - 1) * PAGE_SIZE
  const { where, values, q, bm25Index, hasResidualFilter } = buildFilter(filters)
  const cols = hitColumns(filters.type === 'comment' || filters.type === 'pollopt' || (filters.type === 'all' && Boolean(filters.q)))
  const sort = filters.sort ?? (q ? 'relevance' : 'date')

  let text: string
  let limit: number | null = null

  if (bm25Index && sort === 'relevance') {
    // Page straight off the ranked stream; only score enough to reach this page.
    const order = bm25Order(q, bm25Index, values)
    limit = candidateLimit(offset, hasResidualFilter)
    text = `SELECT ${cols} FROM items ${where} ORDER BY ${order} LIMIT ${push(values, PAGE_SIZE)} OFFSET ${push(values, offset)}`
  } else if (bm25Index) {
    // Date/points sort of a text query: an unranked filter is a seq scan, so pull
    // the BM25 matches (bounded by the cap) and re-sort them. Exact for any query
    // with at most COUNT_CAP matches, which covers all but the broadest terms.
    const order = bm25Order(q, bm25Index, values)
    limit = MAX_CANDIDATES
    text = `SELECT * FROM (SELECT ${cols} FROM items ${where} ORDER BY ${order} LIMIT ${MAX_CANDIDATES}) hits ORDER BY ${plainOrder(sort)} LIMIT ${push(values, PAGE_SIZE)} OFFSET ${push(values, offset)}`
  } else {
    // Browsing or a short prefix: a btree/partial index already provides the order.
    text = `SELECT ${cols} FROM items ${where} ORDER BY ${plainOrder(sort)} LIMIT ${push(values, PAGE_SIZE)} OFFSET ${push(values, offset)}`
  }

  const { rows, ms } = await timed(() => run(limit, text, values))
  return { rows: rows.map(asHit), ms, page }
}

/** Exact counting is abandoned after this long; the estimate takes over. */
const COUNT_TIMEOUT_MS = 400

/** Reads `Plan Rows` out of an `EXPLAIN (FORMAT JSON)` result row. */
function planEstimate(rows: Row[]): number | null {
  const cell = rows[0]?.['QUERY PLAN']
  const plan = typeof cell === 'string' ? JSON.parse(cell) : cell
  const rowsEst = plan?.[0]?.Plan?.['Plan Rows']
  return typeof rowsEst === 'number' ? Math.round(rowsEst) : null
}

/**
 * Match count for the status line. A true count of full-text matches is
 * expensive and plan-fragile (for broad or multi-word terms Postgres walks the
 * whole table), so this races two things in parallel:
 *
 *   1. an exact count, bounded by {@link COUNT_CAP} rows and a hard
 *      `statement_timeout` so it can never hang, and
 *   2. the planner's instant row estimate.
 *
 * When the exact count returns under the cap in time, it wins ("515 results").
 * Otherwise (capped, or too slow) the rounded estimate is shown ("~34,000
 * results"). Returns `count: null` for empty-query browsing.
 */
export async function countMatches(filters: SearchFilters): Promise<MatchCount> {
  const q = filters.q ?? ''
  if (q.length === 0) return { count: null, capped: false, estimate: null, ms: 0 }

  const { where, values, bm25Index } = buildFilter(filters)
  const whereValues = [...values] // WHERE params only, for the EXPLAIN estimate
  const countValues = [...values]
  const inner = bm25Index ? `SELECT 1 FROM items ${where} ORDER BY ${bm25Order(q, bm25Index, countValues)} LIMIT ${COUNT_CAP}` : `SELECT 1 FROM items ${where} LIMIT ${COUNT_CAP}`
  const countText = `SELECT count(*)::int AS n FROM (${inner}) hits`

  const started = performance.now()
  const [estimate, exact] = await Promise.all([
    (async () => {
      try {
        const rows = (await sql.query(`EXPLAIN (FORMAT JSON) SELECT 1 FROM items ${where}`, whereValues)) as Row[]
        return planEstimate(rows)
      } catch {
        return null
      }
    })(),
    (async () => {
      try {
        const stmts = [sql.query(`SET LOCAL statement_timeout = ${COUNT_TIMEOUT_MS | 0}`)]
        if (bm25Index) stmts.push(sql.query(`SET LOCAL lakebase_bm25.default_limit = ${COUNT_CAP | 0}`))
        stmts.push(sql.query(countText, countValues))
        const res = (await sql.transaction(stmts)) as Row[][]
        return asInt(res[res.length - 1][0]?.n) ?? 0
      } catch {
        return null // statement_timeout (or any error): fall back to the estimate
      }
    })(),
  ])
  const ms = performance.now() - started

  const exactOk = exact != null && exact < COUNT_CAP
  return { count: exactOk ? exact : null, capped: !exactOk, estimate: exactOk ? null : estimate, ms }
}

/**
 * Approximate size of the corpus for the footer, read from the planner's cached
 * statistic (`pg_class.reltuples`) instead of a `count(*)`. Sub-millisecond and
 * needs no table scan, and it stays accurate to within an autovacuum cycle,
 * which is plenty for a headline number that grows every hour.
 */
export async function corpusSize(): Promise<number | null> {
  try {
    const rows = (await sql.query(`SELECT reltuples::bigint::text AS n FROM pg_class WHERE relname = 'items'`)) as Row[]
    const n = asInt(rows[0]?.n)
    return n != null && n > 0 ? n : null
  } catch {
    return null
  }
}

export async function getThread(id: number) {
  const { rows, ms } = await timed(
    async () =>
      (await sql.query(
        `WITH RECURSIVE thread AS (
           SELECT ${THREAD_COLUMNS} FROM items WHERE id = $1
           UNION ALL
           SELECT ${THREAD_COLUMNS.split(', ')
             .map((c) => `i.${c}`)
             .join(', ')}
           FROM items i INNER JOIN thread t ON i.parent = t.id
         )
         SELECT * FROM thread`,
        [id],
      )) as Row[],
  )
  return { rows: rows.map(asThread), ms }
}

export async function getUserItems(by: string, page: number) {
  const offset = (page - 1) * PAGE_SIZE
  const { rows, ms } = await timed(
    async () =>
      (await sql.query(
        `SELECT ${hitColumns(true)} FROM items
         WHERE "by" = $1 AND NOT deleted AND NOT dead
         ORDER BY time DESC LIMIT $2 OFFSET $3`,
        [by, PAGE_SIZE, offset],
      )) as Row[],
  )
  return { rows: rows.map(asHit), ms, page }
}

export async function typeahead(term: string): Promise<SearchHit[]> {
  if (!term) return []
  if (term.length <= 2) {
    const rows = (await sql.query(
      `SELECT ${hitColumns(false)} FROM items
       WHERE (title ILIKE $1 OR "by" ILIKE $1) AND NOT deleted AND NOT dead
       ORDER BY time DESC LIMIT 8`,
      [`${term}%`],
    )) as Row[]
    return rows.map(asHit)
  }
  const rows = await run(
    200,
    `SELECT ${hitColumns(false)} FROM items
     WHERE type = 'story' AND NOT deleted AND NOT dead AND search_tsv @@ plainto_tsquery('english', $1)
     ORDER BY search_tsv <@> to_bm25query(to_tsvector('english', $1), '${PARTIAL_BM25.story}')
     LIMIT 8`,
    [term],
  )
  return rows.map(asHit)
}
