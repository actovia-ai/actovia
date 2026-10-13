export interface TextPart {
  text: string
  match: boolean
}

/**
 * `text` cut into runs that are, or are not, one of `words` — every
 * occurrence, case-insensitive, overlaps merged. A search result marks the
 * query's words with it in its title and snippet.
 */
export function splitHighlights(text: string, words: string[]): TextPart[] {
  const lower = text.toLowerCase()
  // A letter whose lower case is longer ('İ') would shift every index after it.
  if (lower.length !== text.length || words.length === 0) {
    return text ? [{ text, match: false }] : []
  }

  const marked = Array.from({ length: text.length }, () => false)
  for (const word of words) {
    const needle = word.toLowerCase()
    if (!needle) continue
    for (
      let at = lower.indexOf(needle);
      at >= 0;
      at = lower.indexOf(needle, at + 1)
    ) {
      marked.fill(true, at, at + needle.length)
    }
  }

  const parts: TextPart[] = []
  for (let i = 0; i < text.length; i++) {
    const last = parts.at(-1)
    if (last && last.match === marked[i]) last.text += text[i]
    else parts.push({ text: text[i], match: marked[i] })
  }
  return parts
}
