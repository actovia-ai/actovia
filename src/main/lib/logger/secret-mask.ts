import { scrubList, scrubWith, type ScrubEntry } from '../secrets/scrub'

/**
 * Secret values the logger masks in every line it writes (final review M4):
 * an error message that quotes a key — a provider's error text, a request URL
 * with `?key=` — would otherwise land in `~/.actovia/logs` and
 * `GET /api/v1/logs` in plaintext. Fed from where secrets are decrypted (the
 * settings cache fill in `db/queries.ts`, every MCP row read in
 * `db/mcp-queries.ts`), so a value is known before anything can use it.
 * Values are only added for the life of the process — a rotated key's old
 * value keeps being masked. In memory only.
 */
const values = new Set<string>()
// Built once per change to `values`, not per line (re-review m5).
let list: ScrubEntry[] | null = []

export function addLogSecrets(secrets: readonly string[]): void {
  let changed = false
  for (const s of secrets) {
    if (s && !values.has(s)) {
      values.add(s)
      changed = true
    }
  }
  if (changed) list = null
}

/** `text` with every known secret masked (as `scrubSecrets` does). */
export function maskLogText(text: string): string {
  if (values.size === 0) return text
  list ??= scrubList([...values])
  return scrubWith(text, list)
}

/** Tests only. */
export function resetLogSecretsForTests(): void {
  values.clear()
  list = []
}
