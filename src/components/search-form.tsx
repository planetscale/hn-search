'use client'

import { stringifySearchParams, type SearchFilters, type SearchSince, type SearchSort, type SearchType } from '@/lib/search-params'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

const TYPES: { id: SearchType; label: string }[] = [
  { id: 'story', label: 'Stories' },
  { id: 'comment', label: 'Comments' },
  { id: 'job', label: 'Jobs' },
  { id: 'all', label: 'All' },
]

const SORTS: { id: SearchSort; label: string }[] = [
  { id: 'relevance', label: 'relevance' },
  { id: 'date', label: 'date' },
  { id: 'score', label: 'points' },
]

const SINCE: { id: SearchSince; label: string }[] = [
  { id: 'all', label: 'all time' },
  { id: '24h', label: 'past 24h' },
  { id: 'week', label: 'past week' },
  { id: 'month', label: 'past month' },
  { id: 'year', label: 'past year' },
]

const DEBOUNCE_MS = 250

function hrefFor(filters: SearchFilters, patch: Partial<SearchFilters>): string {
  const qs = stringifySearchParams({ ...filters, page: undefined, ...patch })
  return qs ? `/?${qs}` : '/'
}

export function SearchForm({ filters }: { filters: SearchFilters }) {
  const router = useRouter()
  const [q, setQ] = useState(filters.q ?? '')
  const filtersRef = useRef(filters)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The last query text we pushed to the URL. Used to tell our own navigations
  // apart from external ones (back/forward, nav links).
  const pushedRef = useRef(filters.q ?? '')
  const [, startTransition] = useTransition()
  filtersRef.current = filters

  // Only adopt the URL's query when it changed for a reason other than our own
  // typing. This never overwrites the box mid-keystroke or moves the cursor.
  useEffect(() => {
    const urlQ = filters.q ?? ''
    if (urlQ !== pushedRef.current) {
      pushedRef.current = urlQ
      setQ(urlQ)
    }
  }, [filters.q])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  // Navigate using the value the user currently sees, so tab/sort changes keep
  // whatever is typed even if a debounce has not fired yet.
  function navigate(nextQ: string, patch: Partial<SearchFilters> = {}) {
    if (timerRef.current) clearTimeout(timerRef.current)
    const trimmed = nextQ.trim()
    pushedRef.current = trimmed
    startTransition(() => router.replace(hrefFor({ ...filtersRef.current, q: trimmed || undefined }, patch)))
  }

  function scheduleQuery(next: string) {
    setQ(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => navigate(next), DEBOUNCE_MS)
  }

  const sort = filters.sort ?? (filters.q ? 'relevance' : 'date')

  return (
    <form
      action="/"
      method="get"
      className="mb-3"
      onSubmit={(event) => {
        event.preventDefault()
        navigate(q)
      }}
    >
      <label className="sr-only" htmlFor="q">
        Search Hacker News
      </label>
      <input
        id="q"
        name="q"
        value={q}
        onChange={(event) => scheduleQuery(event.target.value)}
        placeholder="Search stories, comments, jobs…"
        autoComplete="off"
        autoFocus
        className="w-full border border-(--hn-gray) bg-white px-2 py-1.5 text-(length:--text-base)"
      />

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-(length:--text-sm)">
        <div className="flex gap-x-2">
          {TYPES.map((type) => {
            const active = filters.type === type.id
            return (
              <button key={type.id} type="button" onClick={() => navigate(q, { type: type.id })} className={active ? 'font-bold text-(--hn-orange)' : 'text-(--hn-gray) hover:underline'}>
                {type.label}
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex items-center gap-x-1 text-(--hn-gray)">
          <span>by</span>
          <select value={sort} onChange={(event) => navigate(q, { sort: event.target.value as SearchSort })} className="border border-(--hn-gray) bg-white px-1 py-0.5">
            {SORTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <span>for</span>
          <select value={filters.since} onChange={(event) => navigate(q, { since: event.target.value as SearchSince })} className="border border-(--hn-gray) bg-white px-1 py-0.5">
            {SINCE.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </form>
  )
}
