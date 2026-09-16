import { CorpusCount } from '@/components/corpus-count'
import { GithubMark, VercelMark } from '@/components/logos'
import { PLANETSCALE_URL, SOURCE_URL, TIN_DOCS_URL } from '@/lib/links'
import { Suspense } from 'react'

/** Intro banner shown above the results status line on the home page. */
export function WelcomeNote() {
  return (
    <div className="mb-3 border-l-2 border-(--hn-orange) bg-white px-2 py-1.5 text-(length:--text-sm) text-(--hn-gray)">
      <span className="font-bold text-(--hn-ink)">🔍 Hacker News Search</span>
      <br />
      <br />
      Full-text search over{' '}
      <Suspense fallback="the corpus">
        <CorpusCount />
      </Suspense>
      , synced hourly from HN, live from{' '}
      <a href={PLANETSCALE_URL} target="_blank" className="border-b">
        PlanetScale Postgres
      </a>{' '}
      <a href={TIN_DOCS_URL} target="_blank" className="border-b">
        with TIN BM25 ranking
      </a>{' '}
      and deployed on{' '}
      <a href="https://vercel.com" target="_blank" className="border-b">
        <VercelMark className="inline-block h-[0.9em] w-auto align-[-0.05em]" /> Vercel
      </a>
      <br />
      <br />
      <a href={SOURCE_URL} target="_blank" className="font-bold text-(--hn-orange)">
        <GithubMark className="inline-block h-[1.05em] w-[1.05em] align-[-0.15em]" /> View source
      </a>
    </div>
  )
}
