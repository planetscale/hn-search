import { ItemByline } from '@/components/item-byline'
import { ThreadLoading } from '@/components/loading'
import { QueryMeta } from '@/components/query-meta'
import { itemHeading, stripHtml, timeAgo } from '@/lib/hn'
import { getThread, type ThreadItem } from '@/lib/queries'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'

function childrenByParent(rows: ThreadItem[], rootId: number): Map<number, ThreadItem[]> {
  const byParent = new Map<number, ThreadItem[]>()
  for (const row of rows) {
    if (row.id === rootId) continue
    const key = row.parent ?? -1
    const list = byParent.get(key) ?? []
    list.push(row)
    byParent.set(key, list)
  }
  return byParent
}

function Comments({ parentId, byParent, depth }: { parentId: number; byParent: Map<number, ThreadItem[]>; depth: number }) {
  const kids = byParent.get(parentId) ?? []
  if (!kids.length) return null
  return (
    <ul className={depth === 0 ? 'mt-4 flex flex-col gap-3' : 'mt-2 ml-3 flex flex-col gap-2 border-l border-(--hn-gray-line) pl-3'}>
      {kids.map((item) => (
        <li key={item.id} className="min-w-0">
          <div className="text-(length:--text-xs) text-(--hn-gray)">
            {item.by ? (
              <Link href={`/user/${item.by}`} className="hover:underline">
                {item.by}
              </Link>
            ) : (
              'deleted'
            )}{' '}
            {timeAgo(item.time)}
          </div>
          <div className="max-w-prose text-(length:--text-sm) whitespace-pre-wrap">{item.deleted ? '[deleted]' : stripHtml(item.text)}</div>
          <Comments parentId={item.id} byParent={byParent} depth={depth + 1} />
        </li>
      ))}
    </ul>
  )
}

async function Thread({ id }: { id: number }) {
  const { rows, ms } = await getThread(id)
  const root = rows.find((row) => row.id === id)
  if (!root) notFound()
  const byParent = childrenByParent(rows, id)

  return (
    <article>
      <QueryMeta ms={ms} />
      <h1 className="text-(length:--text-lg) leading-snug font-bold">
        {root.url ? (
          <a href={root.url} target="_blank" rel="noreferrer" className="hover:underline">
            {itemHeading(root)}
          </a>
        ) : (
          itemHeading(root)
        )}
      </h1>
      <div className="mt-0.5">
        <ItemByline item={root} />
      </div>
      {root.text ? <div className="mt-3 max-w-prose text-(length:--text-sm) whitespace-pre-wrap">{stripHtml(root.text)}</div> : null}
      <Comments parentId={id} byParent={byParent} depth={0} />
    </article>
  )
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) notFound()
  return (
    <Suspense key={id} fallback={<ThreadLoading />}>
      <Thread id={id} />
    </Suspense>
  )
}
