// "Ask about this": a piece of a message the user selected travels with
// their next message as a markdown quote — a block of `> ` lines, a blank
// line, the question. Plain text, so every provider reads it as what it is
// and nothing about a message's shape changes; the clients read it back
// with `splitQuoted` to draw the quote as one. actovia-ios has the same
// three functions (`QuotedText`), held to the same vectors.

/** A selection longer than this is cut: it is a pointer, not an upload. */
export const QUOTE_MAX_LENGTH = 2000

/** The selection as the lines of a markdown quote. */
export function quoteBlock(selection: string): string {
  const lines = selection
    .replaceAll('\r\n', '\n')
    .trim()
    .split('\n')
    .map((line) => line.trimEnd())
  let text = lines.join('\n')
  if (text.length > QUOTE_MAX_LENGTH) {
    text = `${text.slice(0, QUOTE_MAX_LENGTH)}…`
  }
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')
}

/** What is sent: the quote, then what the user typed about it. */
export function composeQuoted(quote: string, text: string): string {
  return `${quoteBlock(quote)}\n\n${text.trim()}`
}

/**
 * A message's text as its quote and the rest. The quote is the run of lines
 * that open the message with `>`; blank lines after it belong to neither.
 */
export function splitQuoted(text: string): {
  quote: string | null
  body: string
} {
  const lines = text.split('\n')
  let end = 0
  while (end < lines.length && lines[end].startsWith('>')) end++
  if (end === 0) return { quote: null, body: text }

  const quote = lines
    .slice(0, end)
    .map((line) => line.slice(line.startsWith('> ') ? 2 : 1))
    .join('\n')
  let from = end
  while (from < lines.length && lines[from].trim() === '') from++
  return { quote, body: lines.slice(from).join('\n') }
}
