/**
 * Match markers and the excerpting that turns a highlighted document into a
 * readable result row.
 *
 * `tin.highlight()` wraps every matched run in a pair of tags and returns the
 * whole document; it does not pick an excerpt. The search queries ask for these
 * two control characters rather than `<b>`/`</b>` so nothing downstream has to
 * parse HTML: Hacker News text is user-written, and the only safe way to mark it
 * up is to split on a delimiter that cannot occur in the source and build real
 * elements from the pieces. The queries strip both characters from the text
 * before highlighting, so every marker in a result came from TIN.
 */
export const MARK_OPEN = '\u0001'
export const MARK_CLOSE = '\u0002'

export type Segment = { text: string; match: boolean }

/** How much text to keep before the first match, so it reads in context. */
const EXCERPT_LEAD = 60
/** How much of the document to show, counted without the markers. */
const EXCERPT_LENGTH = 240

/**
 * Splits a highlighted string into plain and matched runs. Text with no markers
 * yields a single plain segment, so this is safe to call on anything. A run left
 * open by excerpting closes at the end.
 */
export function segments(text: string): Segment[] {
  const out: Segment[] = []
  let rest = text
  let match = false
  while (rest.length > 0) {
    const next = rest.indexOf(match ? MARK_CLOSE : MARK_OPEN)
    if (next === -1) {
      out.push({ text: rest, match })
      break
    }
    if (next > 0) out.push({ text: rest.slice(0, next), match })
    rest = rest.slice(next + 1)
    match = !match
  }
  return out.filter((segment) => segment.text.length > 0)
}

/**
 * Trims a highlighted document to a window around its first match, so the part
 * the reader searched for is on screen instead of whatever happened to open the
 * comment. Falls back to the opening of the text when nothing matched. Ellipses
 * mark either end that was cut.
 */
export function excerpt(text: string, lead = EXCERPT_LEAD, length = EXCERPT_LENGTH): string {
  const first = text.indexOf(MARK_OPEN)
  // Step back `lead` visible characters, then to the start of that word.
  let start = 0
  if (first > lead) {
    const space = text.lastIndexOf(' ', first - lead)
    start = space === -1 ? first - lead : space + 1
  }

  let end = start
  let taken = 0
  while (end < text.length && taken < length) {
    const ch = text[end]
    if (ch !== MARK_OPEN && ch !== MARK_CLOSE) taken++
    end++
  }

  const body = text.slice(start, end)
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}
