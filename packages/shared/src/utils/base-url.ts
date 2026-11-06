/**
 * A base URL in a comparable form: trimmed, scheme and host lowercased, no
 * trailing slash. `null` for an empty one ("use the stored / default").
 *
 * The one implementation of the comparison that decides whether a stored key
 * follows an address edit (the main process's destination rule and list-models
 * guard, and the Settings form's mirror of that rule) — so the two sides can
 * never disagree about what counts as a new host.
 * The suffix patterns start only at the beginning of a slash run, avoiding
 * quadratic retries on long paths that have an internal run of slashes.
 */
export function normalizeBaseUrl(
  url: string | null | undefined
): string | null {
  const trimmed = url?.trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)
    return `${u.protocol}//${u.host}${u.pathname.replace(/(?<!\/)\/+$/u, '')}${u.search}`
  } catch {
    return trimmed.replace(/(?<!\/)\/+$/u, '')
  }
}
