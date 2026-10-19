import { randomBytes, timingSafeEqual } from 'crypto'

/**
 * The user-presence capability: a random secret made once per launch, held
 * only in this process's memory, and handed to Actovia's own renderer over IPC
 * (`api:presence-token`, `ipc.ts`). Routes that stand for "the user said so"
 * — answering a tool-approval prompt, pairing and managing devices — require
 * it on loopback (`presenceGate`), so a process on this machine that can
 * reach the API but is not the app's window (a `curl` the model runs through
 * the `terminal` tool) cannot approve its own request or pair itself a
 * device. It is never written to disk, logged, put in an SSE event or shown
 * to a tool.
 */
let token: Buffer | null = null

function current(): Buffer {
  token ??= randomBytes(32)
  return token
}

/** The header the renderer sends it in. */
export const PRESENCE_HEADER = 'x-exodus-presence'

export function getPresenceToken(): string {
  return current().toString('base64url')
}

/** Whether `value` is this launch's token (constant-time). */
export function isPresenceToken(value: string | undefined): boolean {
  if (!value) return false
  const expected = Buffer.from(getPresenceToken())
  const given = Buffer.from(value)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
