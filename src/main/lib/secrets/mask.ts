/**
 * The one shape a secret takes when it leaves the main process (spec
 * 2026-09-25 §2.2): `"•••• " + last4` for a value of 12 characters or more,
 * `"••••"` for anything shorter, `null` for unset. A mask can never be a valid
 * key (no provider key contains `•`), so a posted mask is unambiguous: it
 * means "unchanged".
 */

import { MASK_BULLETS, maskSecret } from '@actovia/shared/utils/secret-detect'

export { maskSecret }

const BULLETS = MASK_BULLETS

/** Either mask shape — `"••••"` or `"•••• " + four characters`. */
export function looksLikeMask(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value === BULLETS) return true
  // Array.from counts code points, so an astral last-4 still reads as 4.
  return (
    value.startsWith(`${BULLETS} `) &&
    Array.from(value.slice(BULLETS.length + 1)).length === 4
  )
}

/**
 * The write rule for one secret: a posted mask keeps `currentPlaintext` (the
 * stored value, as plaintext — see `current.ts`); `null` / `""` clear; anything
 * else is the new value.
 *
 * A mask that is not the current one (stale: the key changed elsewhere since
 * the client read it) is also kept rather than stored — a mask is never a key.
 */
export function resolvePostedSecret<T extends string | null | undefined>(
  posted: T,
  currentPlaintext: string | null | undefined
): T | string | null {
  if (looksLikeMask(posted)) return currentPlaintext ?? null
  return posted
}
