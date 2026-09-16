import { ItemRow } from '@/components/item-row'
import { ResultsLoading } from '@/components/loading'
import { QueryMeta } from '@/components/query-meta'
import { SearchForm } from '@/components/search-form'
import { WelcomeNote } from '@/components/welcome-note'
import { countMatches, searchItems, type MatchCount, type SearchHit } from '@/lib/queries'
import { PAGE_SIZE, pageNumber, parseSearchParams, stringifySearchParams, type SearchFilters } from '@/lib/search-params'
import Link from 'next/link'
import { Suspense } from 'react'

function hrefWith(filters: SearchFilters, patch: Partial<SearchFilters>): string {
  const qs = stringifySearchParams({ ...filters, ...patch })
  return qs ? `/?${qs}` : '/'
}

/** Streams in once the query returns; the search box above it stays interactive. */
async function Results({ filters, page }: { filters: SearchFilters; page: number }) {
  // Start the count alongside the search; it streams into its own inner boundary.
  const countPromise: Promise<MatchCount> | undefined = filters.q ? countMatches(filters).catch(() => ({ count: null, ms: 0 })) : undefined

  let rows: SearchHit[] = []
  let ms = 0
  let fuzzy: string[] = []
  let error: string | null = null
  try {
    const result = await searchItems(filters, page)
    rows = result.rows
    ms = result.ms
    fuzzy = result.fuzzy
  } catch (err) {
    error = err instanceof Error ? err.message : 'Query failed'
  }

  const prev = page > 1 ? hrefWith(filters, { page: String(page - 1) }) : null
  const next = rows.length >= PAGE_SIZE ? hrefWith(filters, { page: String(page + 1) }) : null

  return (
    <div>
      <QueryMeta ms={ms} error={error} countPromise={countPromise} fuzzy={fuzzy} />

      <ol className="flex flex-col gap-2">
        {rows.map((item, index) => (
          <ItemRow key={item.id} item={item} index={(page - 1) * PAGE_SIZE + index + 1} />
        ))}
      </ol>

      {!error && rows.length === 0 ? <p className="text-(--hn-gray)">{filters.q ? 'No matches. Try a different query or type.' : 'No items yet. Seed the corpus, then refresh.'}</p> : null}

      {prev || next ? (
        <nav className="mt-4 flex gap-3 text-(length:--text-sm)">
          {prev ? <Link href={prev}>‹ Prev</Link> : null}
          {next ? <Link href={next}>More ›</Link> : null}
        </nav>
      ) : null}
    </div>
  )
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseSearchParams(await searchParams)
  const page = pageNumber(filters.page)

  return (
    <div>
      <SearchForm filters={filters} />
      <WelcomeNote />
      {/* No key on the boundary. Each search navigates inside a transition, so
          React keeps the results that are on screen mounted and swaps in the new
          ones once they have streamed. The skeleton is only for the first load,
          when there is nothing to hold. */}
      <Suspense fallback={<ResultsLoading />}>
        <Results filters={filters} page={page} />
      </Suspense>
    </div>
  )
}
