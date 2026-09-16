import { ITEM_TYPES, type ItemType } from '@/db/schema'

export const PAGE_SIZE = 30

export type SearchType = 'all' | ItemType
export type SearchSince = '24h' | 'week' | 'month' | 'year' | 'all'
export type SearchSort = 'relevance' | 'date' | 'score'

export type SearchFilters = {
  q?: string
  type: SearchType
  by?: string
  since: SearchSince
  sort?: SearchSort
  page?: string
  /**
   * Set while the search box is mid-word, which tells the query builder that
   * the last word may be unfinished. The form drops it a second after the last
   * keystroke, so a shared or bookmarked URL always carries the settled query.
   */
  typing?: boolean
}

const TYPES = new Set<string>([...ITEM_TYPES, 'all'])
const SINCE = new Set<string>(['24h', 'week', 'month', 'year', 'all'])
const SORTS = new Set<string>(['relevance', 'date', 'score'])

export function parseSearchParams(params: Record<string, string | string[] | undefined>): SearchFilters {
  const one = (key: string) => {
    const value = params[key]
    return typeof value === 'string' ? value : undefined
  }
  const type = one('type')
  const since = one('since')
  const sort = one('sort')
  return {
    q: one('q')?.trim() || undefined,
    type: type && TYPES.has(type) ? (type as SearchType) : 'story',
    by: one('by')?.trim() || undefined,
    since: since && SINCE.has(since) ? (since as SearchSince) : 'all',
    sort: sort && SORTS.has(sort) ? (sort as SearchSort) : undefined,
    page: one('page'),
    typing: one('typing') === '1' || undefined,
  }
}

export function stringifySearchParams(params: Partial<SearchFilters>): string {
  const url = new URLSearchParams()
  if (params.q) url.set('q', params.q)
  if (params.type && params.type !== 'story') url.set('type', params.type)
  if (params.by) url.set('by', params.by)
  if (params.since && params.since !== 'all') url.set('since', params.since)
  if (params.sort) url.set('sort', params.sort)
  if (params.page && params.page !== '1') url.set('page', params.page)
  if (params.typing) url.set('typing', '1')
  return url.toString()
}

export function pageNumber(page: string | undefined): number {
  return Math.max(1, Number(page) || 1)
}

export function sinceCutoff(since: SearchFilters['since']): Date | null {
  if (!since || since === 'all') return null
  const day = 24 * 60 * 60 * 1000
  const ms = since === '24h' ? day : since === 'week' ? 7 * day : since === 'month' ? 30 * day : 365 * day
  return new Date(Date.now() - ms)
}

/** Compact approximate label for a large count, e.g. 48750000 -> "~49M", 28700 -> "~29K". */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `~${Math.round(n / 1_000_000)}M`
  if (n >= 1_000) return `~${Math.round(n / 1_000)}K`
  return `~${Math.round(n)}`
}

/** Renders the exact match count, e.g. "515 results" or "1 result". */
export function formatMatches(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'result' : 'results'}`
}
