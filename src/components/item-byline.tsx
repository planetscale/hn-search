import { Highlight } from '@/components/highlight'
import { timeAgo } from '@/lib/hn'
import type { ItemRecord } from '@/lib/queries'
import Link from 'next/link'

/**
 * `byMarked` is the highlighted author, present only on a search result whose
 * query could match one. A thread or user page has no query to mark up, so the
 * byline falls back to the plain name.
 */
type BylineItem = Pick<ItemRecord, 'id' | 'type' | 'by' | 'time' | 'score' | 'descendants'> & { byMarked?: string | null }

// Points are only meaningful on submissions. HN never shows comment scores.
const SCORED = new Set(['story', 'job', 'poll'])

/** The HN "subtext" line: points, author, age, and a comments link. */
export function ItemByline({ item, comments = false }: { item: BylineItem; comments?: boolean }) {
  return (
    <div className="text-(length:--text-xs) text-(--hn-gray)">
      {SCORED.has(item.type) && item.score != null ? <span>{item.score} points </span> : null}
      {item.by ? (
        <>
          by{' '}
          <Link href={`/user/${item.by}`} className="hover:underline">
            <Highlight text={item.byMarked ?? item.by} />
          </Link>{' '}
        </>
      ) : null}
      <span>{timeAgo(item.time)}</span>
      {comments ? (
        <>
          <span className="mx-1">|</span>
          <Link href={`/item/${item.id}`} className="hover:underline">
            {item.descendants ?? 0} comments
          </Link>
        </>
      ) : null}
    </div>
  )
}
