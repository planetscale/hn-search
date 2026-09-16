import { isTimeout, sql, timed } from '@/db'
import { ITEM_TYPES, type ItemType } from '@/db/schema'
import { PAGE_SIZE, sinceCutoff, type SearchFilters } from '@/lib/search-params'

/**
 * The searchable text every `tin` index is built over, repeated verbatim by
 * every query. Indexing it as an expression keeps the corpus stored once.
 */
const SEARCH_EXPR = `coalesce(title, '') || ' ' || coalesce("by", '') || ' ' || coalesce(regexp_replace(text, '<[^>]+>', ' ', 'g'), '')`

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

export type MatchCount = { count: number | null; ms: number }

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

/**
 * Comment text with its HTML stripped and the highlight markers removed, so the
 * only markers in a result are the ones `tin.highlight()` puts there.
 * `chr(1)`/`chr(2)` are MARK_OPEN and MARK_CLOSE in src/lib/highlight.ts.
 */
const CLEAN_TEXT = `translate(regexp_replace(coalesce(text, ''), '<[^>]+>', ' ', 'g'), chr(1) || chr(2), '')`
const CLEAN_TITLE = `translate(coalesce(title, ''), chr(1) || chr(2), '')`
const MARKS = `chr(1), chr(2)`

/**
 * `mark` is the placeholder already holding the TIN query, or null when there is
 * nothing to highlight. TIN only infers the query for itself when the `==>` is
 * over the highlighted column; ours matches a concatenation of three, so the
 * query is passed explicitly. A query it cannot parse returns the text
 * unchanged, which makes this safe for anything the search box produces.
 *
 * Highlighting returns the whole document and picks no excerpt, so the snippet
 * comes back in full and `excerpt()` trims it around the match at render time.
 */
function hitColumns(withSnippet: boolean, mark: string | null): string {
  const title = mark ? `tin.highlight(${CLEAN_TITLE}, ${MARKS}, ${mark}) AS title` : 'title'
  const snippet = !withSnippet ? `NULL::text AS snippet` : mark ? `tin.highlight(${CLEAN_TEXT}, ${MARKS}, ${mark}) AS snippet` : `left(${CLEAN_TEXT}, 240) AS snippet`
  return `id, type, "by", time, url, score, ${title}, descendants, parent, ${snippet}`
}

const THREAD_COLUMNS = `id, type, "by", time, url, score, title, text, descendants, parent, deleted, dead`

type Token = { kind: 'phrase' | 'word'; text: string; negated: boolean }

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    let ch = input[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    // `-"a phrase"` excludes the phrase, the same way `-word` excludes a word.
    let negated = false
    if (ch === '-' && input[i + 1] === '"') {
      negated = true
      i++
      ch = input[i]
    }
    if (ch === '"') {
      const end = input.indexOf('"', i + 1)
      const inner = end === -1 ? input.slice(i + 1) : input.slice(i + 1, end)
      tokens.push({ kind: 'phrase', text: inner, negated })
      i = end === -1 ? input.length : end + 1
      continue
    }
    let j = i
    while (j < input.length && !/\s/.test(input[j]) && input[j] !== '"') j++
    tokens.push({ kind: 'word', text: input.slice(i, j), negated: false })
    i = j
  }
  return tokens
}

/**
 * Deletes TIN metacharacters (phrases keep their inner spaces) and rejects a
 * token with nothing left to match on: TIN's tokenizer discards pure
 * punctuation, which would otherwise leave an empty term in the query.
 */
function sanitize(text: string): string {
  const clean = text.replace(/["()*~^:\\]/g, '')
  return /[\p{L}\p{N}]/u.test(clean) ? clean : ''
}

type Operand = { text: string; negated: boolean; wildcardable: boolean }
type Piece = { kind: 'operand'; operand: Operand } | { kind: 'operator'; op: 'AND' | 'OR' }

/**
 * How to read the final word in the box: `typing` prefix-matches it, `settled`
 * matches it literally.
 */
export type TailMode = 'settled' | 'typing'

/**
 * A word shorter than this is matched literally rather than prefix-matched,
 * even while the box is still being typed in. Expanding a one- to three-letter
 * prefix unions a large slice of the term dictionary — `th*` matches 20.9M rows
 * where `"th"` matches 9k — so it costs far more than the narrowing it buys.
 */
const MIN_WILDCARD_LENGTH = 4

/**
 * Prefix expansion on these roots is very slow, so a word that is a prefix of
 * one of them is matched literally instead of being wildcarded: `comp*` unions
 * every term under `comput...`, which is most of the corpus.
 */
const NO_WILDCARD_PREFIXES = ['comput'] as const

export type ToTinQueryOptions = {
  noWildcardPrefixes?: readonly string[]
  /** Bare-word operands to fuzz with TIN's `~2` instead of matching literally. */
  fuzzy?: ReadonlySet<string>
}

function isNoWildcardPrefix(text: string, prefixes?: readonly string[]): boolean {
  if (!prefixes?.length) return false
  const lower = text.toLowerCase()
  return prefixes.some((prefix) => prefix.startsWith(lower))
}

/**
 * Converts search-box text into a safe TIN query string.
 *
 * Only the final bare word is treated specially, and only while `tail` is
 * `typing`: the user may not have finished it, so it is matched as a prefix
 * (`openbsd chro` becomes `"openbsd" AND chro*`). That holds until they press
 * Enter, which settles the query and matches the word literally. A word of one
 * to three characters is matched literally either way. Phrases and negated
 * terms are never prefix-matched.
 */
export function toTinQuery(
  input: string,
  tail: TailMode = 'settled',
  options?: ToTinQueryOptions,
): string {
  const tokens = tokenize(input)
  const pieces: Piece[] = []

  for (const token of tokens) {
    if (token.kind === 'word' && (token.text === 'OR' || token.text === 'AND')) {
      pieces.push({ kind: 'operator', op: token.text })
      continue
    }
    if (token.kind === 'word' && token.text.startsWith('-') && token.text.length > 1) {
      const clean = sanitize(token.text.slice(1))
      if (!clean) continue
      pieces.push({ kind: 'operand', operand: { text: clean, negated: true, wildcardable: false } })
      continue
    }
    if (token.kind === 'phrase') {
      const clean = sanitize(token.text)
      if (!clean) continue
      pieces.push({ kind: 'operand', operand: { text: clean, negated: token.negated, wildcardable: false } })
      continue
    }
    const clean = sanitize(token.text)
    if (!clean) continue
    pieces.push({ kind: 'operand', operand: { text: clean, negated: false, wildcardable: true } })
  }

  // Locate the word the user may still be typing and prefix-match it.
  let wildcardIndex = -1
  if (tail === 'typing') {
    for (let i = pieces.length - 1; i >= 0; i--) {
      const piece = pieces[i]
      if (piece.kind !== 'operand') continue
      const text = piece.operand.text
      if (
        piece.operand.wildcardable &&
        [...text].length >= MIN_WILDCARD_LENGTH &&
        !isNoWildcardPrefix(text, options?.noWildcardPrefixes)
      ) {
        wildcardIndex = i
      }
      break
    }
  }

  const parts: string[] = []
  let pendingOp: 'AND' | 'OR' | null = null
  let haveOperand = false

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]
    if (piece.kind === 'operator') {
      pendingOp = piece.op
      continue
    }
    const { operand } = piece
    if (operand.negated) {
      if (!haveOperand) {
        pendingOp = null
        continue // no positive operand precedes it
      }
      parts.push('AND')
      parts.push(`NOT ${quoteOperand(operand.text, 'plain')}`)
      pendingOp = null
      continue
    }
    const mode = options?.fuzzy?.has(operand.text) ? 'fuzzy' : i === wildcardIndex ? 'wildcard' : 'plain'
    const emitted = quoteOperand(operand.text, mode)
    if (haveOperand) parts.push(pendingOp === 'OR' ? 'OR' : 'AND')
    parts.push(emitted)
    haveOperand = true
    pendingOp = null
  }

  return parts.join(' ')
}

type OperandMode = 'plain' | 'wildcard' | 'fuzzy'

function quoteOperand(text: string, mode: OperandMode): string {
  if (mode === 'fuzzy') return `${text}~2`
  if (mode === 'wildcard') return `${text}*`
  return `"${text}"`
}

/**
 * A word shorter than this is skipped as a fuzzy candidate: edit distance 2 on
 * a shorter word matches nearly anything in the dictionary, so fuzzing it
 * would widen the search rather than rescue it.
 */
const MIN_FUZZY_LENGTH = 4

/**
 * The bare, positive words in the query that are eligible to be fuzzed:
 * skips `AND`/`OR` operators, negated words, and phrases (fuzzing a phrase or
 * an exclusion would change what the user asked for, not just widen it).
 */
export function fuzzyCandidates(input: string): string[] {
  const seen = new Set<string>()
  for (const token of tokenize(input)) {
    if (token.kind !== 'word') continue
    if (token.text === 'OR' || token.text === 'AND') continue
    if (token.text.startsWith('-') && token.text.length > 1) continue
    const clean = sanitize(token.text)
    if (!clean || [...clean].length < MIN_FUZZY_LENGTH) continue
    seen.add(clean)
  }
  return [...seen]
}

type Filter = {
  where: string
  values: unknown[]
  q: string
  /** Whether the query text produced a TIN text-match clause. */
  hasTextMatch: boolean
  /** Placeholder holding the TIN query, for `tin.highlight()` to reuse. */
  textParam: string | null
}

type BuildFilterOptions = {
  fuzzy?: ReadonlySet<string>
  queryOverride?: string
  tailOverride?: TailMode
}

function buildFilter(filters: SearchFilters, options?: BuildFilterOptions): Filter {
  const values: unknown[] = []
  const clauses: string[] = []
  const q = options?.queryOverride ?? filters.q ?? ''
  const type = filters.type
  const scoped = type !== 'all' && (ITEM_TYPES as readonly string[]).includes(type)

  const tail = options?.tailOverride ?? (filters.typing ? 'typing' : 'settled')
  const tinQuery = toTinQuery(q, tail, { fuzzy: options?.fuzzy, noWildcardPrefixes: NO_WILDCARD_PREFIXES })
  const hasTextMatch = tinQuery.length > 0
  let textParam: string | null = null

  clauses.push('NOT deleted', 'NOT dead')
  // A validated literal, never user text, so the planner can match it against
  // the per-type index predicate and scope the search to that type alone.
  if (scoped) clauses.push(`type = '${type}'`)

  if (hasTextMatch) {
    textParam = push(values, tinQuery)
    clauses.push(`(${SEARCH_EXPR}) ==> ${textParam}`)
  } else if (type !== 'comment') {
    clauses.push(`title IS NOT NULL AND title <> ''`)
  }

  if (filters.by) clauses.push(`"by" = ${push(values, filters.by)}`)
  const cutoff = sinceCutoff(filters.since)
  if (cutoff) clauses.push(`time >= ${push(values, cutoff.toISOString())}::timestamptz`)

  return { where: `WHERE ${clauses.join(' AND ')}`, values, q, hasTextMatch, textParam }
}

/** Chronological / points ordering, matching the btree index directions (time DESC is NULLS FIRST). */
function plainOrder(sort: SearchFilters['sort']): string {
  return sort === 'score' ? 'score DESC NULLS LAST, time DESC' : 'time DESC'
}

export async function searchItems(filters: SearchFilters, page: number) {
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE
  const fuzzy = await resolveFuzzy(filters)
  const { where, values, q, hasTextMatch, textParam } = buildFilter(filters, { fuzzy })
  const cols = hitColumns(filters.type === 'comment' || filters.type === 'pollopt' || (filters.type === 'all' && Boolean(filters.q)), textParam)
  const sort = filters.sort ?? (q ? 'relevance' : 'date')
  const ranked = hasTextMatch && sort === 'relevance'
  const order = ranked ? 'tin.score(ctid) DESC' : plainOrder(sort)
  const window = `ORDER BY ${order} LIMIT ${push(values, PAGE_SIZE)} OFFSET ${push(values, offset)}`

  // Highlighting costs per row, and only a ranked scan bounds how many rows get
  // one: TIN pushes the page into the index as a top-K, so it projects a page's
  // worth. Ordering by anything else sorts every match, and the highlight would
  // be computed for all of them — four and a half seconds for a common word — so
  // there the page is chosen first and only those rows are highlighted.
  const text = textParam && !ranked ? `SELECT ${cols} FROM items WHERE id IN (SELECT id FROM items ${where} ${window}) ORDER BY ${order}` : `SELECT ${cols} FROM items ${where} ${window}`

  const { rows, ms } = await timed(async () => {
    try {
      return (await sql.query(text, values)) as Row[]
    } catch (err) {
      if (isTimeout(err)) throw new Error('That search took too long. Try narrowing it.')
      throw err
    }
  })
  return { rows: rows.map(asHit), ms, page, fuzzy: [...fuzzy].sort() }
}

/**
 * The filter is exactly a `tin` index's predicate plus its text match, so TIN
 * answers `count(*)` from the index alone — no cap and no planner-estimate
 * fallback. Counting the 29M comments containing "the" touches about a hundred
 * index pages, which is what makes the fuzzy fallback's repeated counts cheap
 * enough to run on a keystroke.
 *
 * The aggregate is selected bare. Casting it — even to `int` — costs TIN the
 * custom scan that makes this cheap, and the count falls back to a scan that is
 * seventy times slower. It arrives as a bigint string and is narrowed here
 * instead.
 */
async function countFor(filters: SearchFilters, options?: BuildFilterOptions): Promise<number> {
  const { where, values } = buildFilter(filters, options)
  const rows = (await sql.query(`SELECT count(*) AS n FROM items ${where}`, values)) as Row[]
  return asInt(rows[0]?.n) ?? 0
}

/**
 * Match count for the status line, counting the same fuzzy-rewritten query the
 * results came from.
 *
 * Returns `count: null` when there is nothing to count: an empty box, or a box
 * holding only a word too short to search on yet, where the total would be the
 * size of the corpus rather than an answer to anything the user asked.
 */
export async function countMatches(filters: SearchFilters): Promise<MatchCount> {
  const { hasTextMatch } = buildFilter(filters)
  if (!hasTextMatch) return { count: null, ms: 0 }

  const started = performance.now()
  const fuzzy = await resolveFuzzy(filters)
  const count = await countFor(filters, { fuzzy })
  return { count, ms: performance.now() - started }
}

/**
 * A search with fewer matches than this is treated as one worth rescuing, and
 * fuzzing stops as soon as it clears the bar.
 */
const FUZZY_THRESHOLD = 7

/**
 * Groups cached counts by the non-text filters they were measured under: the
 * cardinality of a word depends on the type, author and date range it was
 * counted within, so a count taken under one set of filters says nothing about
 * the same word under another.
 */
function filterKey(filters: SearchFilters): string {
  return `${filters.type}|${filters.by ?? ''}|${filters.since}`
}

const termCounts = new Map<string, Map<string, Promise<number>>>()

/** Roughly the number of distinct words a session can type; past it, start over. */
const TERM_COUNT_LIMIT = 500

/**
 * How many rows a single word matches on its own, memoized for the life of the
 * process. This is the only thing worth remembering across keystrokes: a word's
 * cardinality is a fact about the corpus, not about the query it appeared in, so
 * it never goes stale while the corpus is being read. Everything downstream of
 * it — which words are the rare ones, which get fuzzed — is decided fresh every
 * time, because a single keystroke can reorder it.
 */
function termCount(filters: SearchFilters, term: string): Promise<number> {
  const key = filterKey(filters)
  let counts = termCounts.get(key)
  if (!counts) {
    counts = new Map()
    termCounts.set(key, counts)
  }
  const cached = counts.get(term)
  if (cached) return cached
  const pending = countFor(filters, { queryOverride: term, tailOverride: 'settled' })
  if (counts.size >= TERM_COUNT_LIMIT) counts.clear()
  counts.set(term, pending)
  return pending
}

/**
 * Decides which of the query's words to fuzz, from scratch, for the query
 * exactly as it stands.
 *
 * The query as typed is counted first — last word wildcarded, by the usual
 * rules — and a result that already clears `FUZZY_THRESHOLD` is left alone.
 * Otherwise each candidate word is counted on its own and the rarest goes
 * first: the word that matches least is the one most likely to be the typo.
 * Words are fuzzed one at a time until the count clears the threshold or the
 * candidates run out, which is what rescues two typos in one query.
 *
 * Re-deciding on every keystroke is the point. In `planetscale databse`, at
 * `planetscale d` the correctly spelled `planetscale` is the rarer word and
 * would be the one fuzzed; by `planetscale databs` the half-typed word has
 * taken that place, and the earlier answer has to be forgotten for the right
 * word to win.
 */
async function computeFuzzy(filters: SearchFilters): Promise<string[]> {
  const candidates = fuzzyCandidates(filters.q ?? '')
  if (candidates.length === 0) return []

  if ((await countFor(filters)) >= FUZZY_THRESHOLD) return []

  const counts = await Promise.all(candidates.map((candidate) => termCount(filters, candidate)))
  const ordered = candidates.map((candidate, i) => ({ candidate, count: counts[i] })).sort((a, b) => a.count - b.count)

  const fuzzed: string[] = []
  for (const { candidate } of ordered) {
    fuzzed.push(candidate)
    const count = await countFor(filters, { fuzzy: new Set(fuzzed) })
    if (count >= FUZZY_THRESHOLD) break
  }
  return fuzzed
}

const inFlight = new Map<string, Promise<string[]>>()

/**
 * The words to fuzz for this query. `searchItems` and `countMatches` both ask,
 * and both must get the same answer over the same query text, so the in-flight
 * decision is shared for as long as it takes to resolve and then dropped. It is
 * a way of asking once per render, not a memo: the next keystroke decides again.
 */
export async function resolveFuzzy(filters: SearchFilters): Promise<ReadonlySet<string>> {
  const key = `${filterKey(filters)}|${filters.typing ? 1 : 0}|${filters.q ?? ''}`
  const pending = inFlight.get(key) ?? computeFuzzy(filters)
  inFlight.set(key, pending)
  try {
    return new Set(await pending)
  } finally {
    inFlight.delete(key)
  }
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
        `SELECT ${hitColumns(true, null)} FROM items
         WHERE "by" = $1 AND NOT deleted AND NOT dead
         ORDER BY time DESC LIMIT $2 OFFSET $3`,
        [by, PAGE_SIZE, offset],
      )) as Row[],
  )
  return { rows: rows.map(asHit), ms, page }
}

export async function typeahead(term: string): Promise<SearchHit[]> {
  // Always mid-word: a typeahead is asked for on every keystroke.
  const tinQuery = toTinQuery(term, 'typing', { noWildcardPrefixes: NO_WILDCARD_PREFIXES })
  if (!tinQuery) return []
  const rows = (await sql.query(
    `SELECT ${hitColumns(false, null)} FROM items
     WHERE type = 'story' AND NOT deleted AND NOT dead AND (${SEARCH_EXPR}) ==> $1
     ORDER BY tin.score(ctid) DESC
     LIMIT 8`,
    [tinQuery],
  )) as Row[]
  return rows.map(asHit)
}
