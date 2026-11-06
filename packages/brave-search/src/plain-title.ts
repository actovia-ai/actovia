/**
 * A page title as a line of text. Search APIs hand titles over with bits of
 * the page's own HTML in them — `<br>`, `<strong>`, `&amp;` (a Japanese
 * ministry's press release, 2026-10-23) — and a title is shown as text, so
 * the markup would be printed. A line break becomes a space, other tags go,
 * the common entities are decoded, and runs of space are one.
 * This is display normalization for text nodes, never an HTML sanitizer.
 * Renderers must keep treating the result as text, including decoded tags.
 */
export function plainTitle(title: string): string {
  return removeTitleTags(title.replace(/<br\s*\/?>|&lt;br\s*\/?&gt;/gi, ' '))
    .replace(
      /&(amp|lt|gt|quot|#39|apos|nbsp);/g,
      (_, name: string) => ENTITIES[name]
    )
    .replace(/\s+/g, ' ')
    .trim()
}

/** Consume each tag once; an unclosed tag ends the scan without retries. */
function removeTitleTags(title: string): string {
  const parts: string[] = []
  let from = 0
  let open = title.indexOf('<')
  while (open !== -1) {
    const name = open + (title[open + 1] === '/' ? 2 : 1)
    if (!/[A-Za-z]/u.test(title[name] ?? '')) {
      open = title.indexOf('<', open + 1)
      continue
    }
    const close = title.indexOf('>', name + 1)
    if (close === -1) break
    parts.push(title.slice(from, open))
    from = close + 1
    open = title.indexOf('<', from)
  }
  parts.push(title.slice(from))
  return parts.join('')
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' '
}
