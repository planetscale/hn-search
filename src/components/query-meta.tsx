import type { MatchCount } from '@/lib/queries'
import { formatMatches } from '@/lib/search-params'
import { Suspense } from 'react'

/** Resolves the streamed count. Rendered inside a Suspense boundary so the
 * result list paints before the (sometimes slower) exact count arrives. */
async function Count({ promise }: { promise: Promise<MatchCount> }) {
  const { count } = await promise
  if (count == null) return null // browsing: no total to show
  return (
    <>
      {formatMatches(count)}
      <Sep />
    </>
  )
}

function Sep() {
  return <span className="mx-1 opacity-50">·</span>
}

/** The gray status line under the search box: match count, query latency, source. */
export function QueryMeta({ ms, error, countPromise, fuzzy }: { ms: number; error?: string | null; countPromise?: Promise<MatchCount>; fuzzy?: string[] }) {
  if (error) return <p className="mb-3 text-(length:--text-sm) text-(--hn-gray)">{error}</p>
  return (
    <p className="mb-3 text-(length:--text-sm) text-(--hn-gray)">
      {countPromise ? (
        <Suspense
          fallback={
            <>
              counting…
              <Sep />
            </>
          }
        >
          <Count promise={countPromise} />
        </Suspense>
      ) : null}
      {fuzzy && fuzzy.length > 0 ? (
        <>
          fuzzy: {fuzzy.map((term) => `${term}~2`).join(', ')}
          <Sep />
        </>
      ) : null}
      {ms.toFixed(0)} ms
      <Sep />
    </p>
  )
}
