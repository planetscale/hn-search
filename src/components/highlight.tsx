import { segments } from '@/lib/highlight'
import { Fragment } from 'react'

/**
 * Renders text that `tin.highlight()` marked up, with the matched runs in
 * `<mark>`. The markers are split out into real elements rather than injected
 * as HTML, so nothing in a Hacker News comment can become markup.
 */
export function Highlight({ text }: { text: string }) {
  return (
    <>
      {segments(text).map((segment, i) =>
        segment.match ? (
          <mark key={i} className="bg-(--hn-orange)/25 text-(--hn-ink)">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </>
  )
}
