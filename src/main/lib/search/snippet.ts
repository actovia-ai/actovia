import removeMd from 'remove-markdown'

/** The longest snippet, ellipses aside, and how much of it leads the match. */
const SNIPPET_LENGTH = 160
const SNIPPET_LEAD = 40
/** How far a cut may move to land between two words instead of inside one. */
const WORD_SLACK = 12

// 【1-source】 and 【84,85,86-source】, the markers the model cites a web search with.
// The space before one goes with it, or "11 【3-source】." would read "11 ."
const CITATION = /\s*【[^】]*-source】/gu
// A table's header rule (`|---|:--:|`); its cell pipes go with the whitespace.
const TABLE_RULE = /^[\s|:-]*-{3,}[\s|:-]*$/gmu

/** The query's words, as both search providers and the snippet see them. */
export function searchWords(query: string): string[] {
  return query.trim().split(/\s+/u).filter(Boolean)
}

/** A message's search text as a line of plain prose. */
export function plainSearchText(text: string): string {
  return removeMd(text.replaceAll(CITATION, ''))
    .replaceAll(TABLE_RULE, ' ')
    .replaceAll(/\s*\|\s*/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
}

// `codePointAt` on the second half of a pair answers that half alone.
const isLowSurrogate = (code = 0) => code >= 0xdc00 && code <= 0xdfff

/**
 * The part of a message a search result shows: at most ~160 characters of
 * plain text with about 40 before the first matched word (case-insensitive),
 * '…' where it was cut. Text in which no word survives the Markdown cleanup
 * (a word inside a link's URL) shows from its start.
 */
export function buildSnippet(text: string, words: string[]): string {
  const plain = plainSearchText(text)
  if (plain.length <= SNIPPET_LENGTH) return plain

  const lower = plain.toLowerCase()
  let at = -1
  let matchEnd = 0
  for (const word of words) {
    const i = lower.indexOf(word.toLowerCase())
    if (i >= 0 && (at < 0 || i < at)) {
      at = i
      matchEnd = i + word.length
    }
  }

  let start = Math.max(
    0,
    Math.min(at - SNIPPET_LEAD, plain.length - SNIPPET_LENGTH)
  )
  let end = Math.min(plain.length, start + SNIPPET_LENGTH)

  // Latin text cuts between words; CJK has no spaces nearby and cuts anywhere.
  if (start > 0 && plain[start - 1] !== ' ') {
    const space = plain.indexOf(' ', start)
    if (space >= 0 && space < start + WORD_SLACK && (at < 0 || space < at)) {
      start = space + 1
    }
  }
  if (end < plain.length && plain[end] !== ' ') {
    const space = plain.lastIndexOf(' ', end)
    if (space > end - WORD_SLACK && space >= matchEnd) end = space
  }
  if (isLowSurrogate(plain.codePointAt(start))) start++
  if (end < plain.length && isLowSurrogate(plain.codePointAt(end))) end--

  return `${start > 0 ? '…' : ''}${plain.slice(start, end).trim()}${end < plain.length ? '…' : ''}`
}
