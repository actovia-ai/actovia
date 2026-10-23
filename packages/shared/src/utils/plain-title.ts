/**
 * A page title as a line of text. Search APIs hand titles over with bits of
 * the page's own HTML in them — `<br>`, `<strong>`, `&amp;` (a Japanese
 * ministry's press release, 2026-10-23) — and a title is shown as text, so
 * the markup would be printed. A line break becomes a space, other tags go,
 * the common entities are decoded, and runs of space are one.
 */
export function plainTitle(title: string): string {
  return title
    .replace(/<br\s*\/?>|&lt;br\s*\/?&gt;/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(
      /&(amp|lt|gt|quot|#39|apos|nbsp);/g,
      (_, name: string) => ENTITIES[name]
    )
    .replace(/\s+/g, ' ')
    .trim()
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
