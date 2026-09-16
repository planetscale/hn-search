'use client'

import { stringifySearchParams, type SearchFilters, type SearchSince, type SearchSort, type SearchType } from '@/lib/search-params'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useTransition } from 'react'

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

/** How long the box waits after a keystroke before it asks the server. */
const DEBOUNCE_MS = 1

function hrefFor(filters: SearchFilters, patch: Partial<SearchFilters>): string {
  const qs = stringifySearchParams({ ...filters, page: undefined, ...patch })
  return qs ? `/?${qs}` : '/'
}

/**
 * How many recently pushed query strings to remember. Only needs to cover the
 * navigations that can still be in flight at once, and typing cannot outrun the
 * network by anything close to this many keystrokes.
 */
const PUSHED_HISTORY = 32

export function SearchForm({ filters }: { filters: SearchFilters }) {
  const router = useRouter()
  // The box is uncontrolled: the browser owns its text and its caret, and React
  // never rewrites the value while it is being typed in. A controlled value is
  // what caused Safari to drop keystrokes and jump the caret to the start — a
  // re-render mid-word rewrites the DOM value and resets the selection with it.
  const inputRef = useRef<HTMLInputElement>(null)
  const initialQ = useRef(filters.q ?? '')
  const filtersRef = useRef(filters)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Every query text this form has recently put in the URL, not just the last
  // one. Each keystroke starts its own navigation and their responses can land
  // out of order, so a URL holding older text is still our own doing and must
  // not be mistaken for someone pressing Back.
  const pushedRef = useRef<string[]>([filters.q ?? ''])
  const [, startTransition] = useTransition()
  filtersRef.current = filters

  /** The text as it stands in the box, which is the only authority on it. */
  function currentQ(): string {
    return inputRef.current?.value ?? initialQ.current
  }

  // Adopt the URL's query only when it arrived for a reason other than our own
  // typing: back/forward, or a nav link. Writing to the DOM node directly keeps
  // this the one place the box is ever overwritten.
  useEffect(() => {
    const urlQ = filters.q ?? ''
    if (pushedRef.current.includes(urlQ)) return
    pushedRef.current = [urlQ]
    const input = inputRef.current
    if (input && input.value !== urlQ) input.value = urlQ
  }, [filters.q])

  function clearTimer() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  useEffect(() => clearTimer, [])

  /**
   * Navigate using the value the user currently sees, so tab and sort changes
   * keep whatever is typed even if the debounce has not fired yet.
   *
   * `typing` marks the last word as one the user may still be adding to, which
   * makes it a prefix match. Typing sets it and Enter clears it; a tab or sort
   * change passes no opinion and leaves it as it was, so switching tabs never
   * silently changes what is being searched for.
   */
  function navigate(nextQ: string, patch: Partial<SearchFilters> = {}, typing = filtersRef.current.typing ?? false) {
    clearTimer()
    const trimmed = nextQ.trim()
    pushedRef.current = [...pushedRef.current, trimmed].slice(-PUSHED_HISTORY)
    startTransition(() => router.replace(hrefFor({ ...filtersRef.current, q: trimmed || undefined, typing: typing || undefined }, patch)))
  }

  function scheduleQuery(next: string) {
    clearTimer()
    timerRef.current = setTimeout(() => navigate(next, {}, true), DEBOUNCE_MS)
  }

  const sort = filters.sort ?? (filters.q ? 'relevance' : 'date')

  return (
    <form
      action="/"
      method="get"
      className="mb-3"
      onSubmit={(event) => {
        event.preventDefault()
        // Enter settles the query: the last word stops being a prefix.
        navigate(currentQ(), {}, false)
      }}
    >
      <label className="sr-only" htmlFor="q">
        Search Hacker News
      </label>
      <input
        id="q"
        name="q"
        ref={inputRef}
        defaultValue={initialQ.current}
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
              <button key={type.id} type="button" onClick={() => navigate(currentQ(), { type: type.id })} className={active ? 'font-bold text-(--hn-orange)' : 'text-(--hn-gray) hover:underline'}>
                {type.label}
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex items-center gap-x-1 text-(--hn-gray)">
          <span>by</span>
          <select value={sort} onChange={(event) => navigate(currentQ(), { sort: event.target.value as SearchSort })} className="border border-(--hn-gray) bg-white px-1 py-0.5">
            {SORTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <span>for</span>
          <select value={filters.since} onChange={(event) => navigate(currentQ(), { since: event.target.value as SearchSince })} className="border border-(--hn-gray) bg-white px-1 py-0.5">
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
