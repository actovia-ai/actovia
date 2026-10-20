// The phone's Health workspace "ask about this": a question typed there
// travels to Chat with the day's numbers as a leading fenced block —
// ```actovia-health, the JSON, ```, a blank line, the question. Plain text,
// like a quote (`quoted-text.ts`), so every provider reads it as what it is;
// the clients read it back with `splitHealth` to draw the numbers as a card.
// actovia-ios has the same rule (`HealthContext.split`), held to the same
// vectors. Display only: what is sent never changes.

export const HEALTH_INFO_STRING = 'actovia-health'

const OPENING = `\`\`\`${HEALTH_INFO_STRING}\n`
const CLOSING = '\n```'

/**
 * A message's text as its health block's JSON and the rest. Only a block that
 * opens the message counts; it ends at the first line that is exactly the
 * closing fence. A block that never closes is not one.
 */
export function splitHealth(text: string): {
  json: string | null
  body: string
} {
  if (!text.startsWith(OPENING)) return { json: null, body: text }
  const rest = text.slice(OPENING.length)
  let end = rest.indexOf(`${CLOSING}\n`)
  let after = end + CLOSING.length + 1
  if (end === -1 && rest.endsWith(CLOSING)) {
    end = rest.length - CLOSING.length
    after = rest.length
  }
  if (end === -1) return { json: null, body: text }
  return { json: rest.slice(0, end), body: rest.slice(after).trim() }
}
