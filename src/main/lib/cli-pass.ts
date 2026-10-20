import { randomBytes, timingSafeEqual } from 'crypto'

/**
 * A short-lived stand-in for the presence token, for `actovia pair` /
 * `actovia devices` run in a shell on this machine (over SSH on a homelab Mac
 * nobody looks at). The CLI gets one from `POST /api/v1/lock/cli-pass` by
 * sending the app-lock PIN — something a person types and the model, which
 * reaches loopback through `terminal` too, does not know — and sends it in
 * the presence header. It opens the device routes only (`CLI_PASS_PATHS`),
 * never a tool approval or anything else behind the presence gate, and
 * lapses after `CLI_PASS_TTL_MS`. Held in memory only; a restart drops
 * every pass.
 */
export const CLI_PASS_TTL_MS = 10 * 60 * 1000
export const CLI_PASS_PATHS = ['/api/v1/devices']

const passes = new Map<string, number>()

export function issueCliPass(now: number = Date.now()): {
  token: string
  expiresAt: number
} {
  for (const [t, until] of passes) if (until <= now) passes.delete(t)
  const token = randomBytes(32).toString('base64url')
  const expiresAt = now + CLI_PASS_TTL_MS
  passes.set(token, expiresAt)
  return { token, expiresAt }
}

/** Whether `value` is a live pass and `path` one it opens (constant-time compare). */
export function isCliPass(
  value: string | undefined,
  path: string,
  now: number = Date.now()
): boolean {
  if (!value) return false
  if (!CLI_PASS_PATHS.some((p) => path === p || path.startsWith(`${p}/`)))
    return false
  const given = Buffer.from(value)
  for (const [t, until] of passes) {
    const expected = Buffer.from(t)
    if (given.length === expected.length && timingSafeEqual(given, expected)) {
      if (until > now) return true
      passes.delete(t)
      return false
    }
  }
  return false
}

/** Tests only. */
export function clearCliPasses(): void {
  passes.clear()
}
