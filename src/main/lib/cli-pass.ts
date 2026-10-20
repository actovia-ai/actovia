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

/**
 * Guesses at the PIN through `POST /api/v1/lock/cli-pass`. The lock screen's
 * own lockout lets five wrong PINs through every thirty seconds, which a
 * loop of `curl` from the model's terminal could keep up for days; this one
 * is stricter, and counts misses across lockouts: past
 * `CLI_PIN_FREE_MISSES` each further miss doubles the wait, and after
 * `CLI_PIN_MAX_MISSES` no pass is issued at all until the PIN is typed on
 * Actovia's own lock screen (`resetCliPinMisses`, from `LockManager.unlock`)
 * or the app restarts. A right PIN clears the count.
 */
export const CLI_PIN_FREE_MISSES = 5
export const CLI_PIN_MAX_MISSES = 10
const CLI_PIN_BASE_DELAY_MS = 30_000

let misses = 0
let blockedUntil = 0

export type CliPinGate =
  | { open: true }
  | { open: false; disabled: true }
  | { open: false; disabled: false; retryAfterMs: number }

export function cliPinGate(now: number = Date.now()): CliPinGate {
  if (misses >= CLI_PIN_MAX_MISSES) return { open: false, disabled: true }
  if (blockedUntil > now)
    return { open: false, disabled: false, retryAfterMs: blockedUntil - now }
  return { open: true }
}

export function recordCliPinMiss(now: number = Date.now()): void {
  misses++
  if (misses >= CLI_PIN_FREE_MISSES && misses < CLI_PIN_MAX_MISSES) {
    blockedUntil =
      now + CLI_PIN_BASE_DELAY_MS * 2 ** (misses - CLI_PIN_FREE_MISSES)
  }
}

/** A right PIN through the CLI, or one typed on the lock screen. */
export function resetCliPinMisses(): void {
  misses = 0
  blockedUntil = 0
}

/** Tests only. */
export function clearCliPasses(): void {
  passes.clear()
  resetCliPinMisses()
}
