import removeMd from 'remove-markdown'

// A table's header rule (`|---|:--:|`); its cell pipes go with the whitespace.
const TABLE_RULE = /^[\s|:-]*-{3,}[\s|:-]*$/gmu

/**
 * Markdown as one line of prose, for a line or two of preview text (a web
 * snippet, the last message of a group). The same cleanup main's search
 * snippets get (`plainSearchText` in `src/main/lib/search/snippet.ts`):
 * `remove-markdown` leaves a table's rule and pipes, which read as noise.
 */
export function plainText(markdown: string): string {
  return removeMd(markdown)
    .replaceAll(TABLE_RULE, ' ')
    .replaceAll(/\s*\|\s*/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
}
