import { normalizeBaseUrl } from '@exodus/shared/utils/base-url'
import { get, set } from 'lodash-es'

/**
 * What the Settings form knows about secrets. The API hands every stored key
 * out as a mask (`"•••• abcd"`, or `"••••"` when short — `src/main/lib/secrets/
 * mask.ts`), and a mask posted back means "unchanged". Nothing here decides
 * anything the server does not: these mirror its rules so the form can say
 * what a save will do before it is made.
 */

export const MASK_TOKEN = '••••'

/** Either mask shape — `"••••"` or `"•••• " + four characters`. */
export function looksLikeMask(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value === MASK_TOKEN) return true
  return (
    value.startsWith(`${MASK_TOKEN} `) &&
    Array.from(value.slice(MASK_TOKEN.length + 1)).length === 4
  )
}

/** A value that still carries a mask somewhere (a URL, an argument). */
export function holdsMask(value: unknown): boolean {
  return typeof value === 'string' && value.includes(MASK_TOKEN)
}

/**
 * The new value of a key field that showed `mask` and now reads `next`: what
 * the user typed or pasted over it, or `""` (cleared) when they only deleted.
 * A mask is never edited in place — half a mask is not a key.
 */
export function replaceMask(mask: string, next: string): string {
  let start = 0
  while (
    start < mask.length &&
    start < next.length &&
    mask[start] === next[start]
  )
    start++
  let end = 0
  while (
    end < mask.length - start &&
    end < next.length - start &&
    mask[mask.length - 1 - end] === next[next.length - 1 - end]
  )
    end++
  return next.slice(start, next.length - end)
}

// The same comparison as the main process — one implementation.
export { normalizeBaseUrl }

/**
 * Where each destination-bound secret is sent: the address field and its
 * default. The main process's `SECRET_DESTINATIONS` (`secrets/registry.ts`);
 * `tests/unit/renderer/lib/secrets.test.ts` keeps the two equal.
 */
export const SECRET_DESTINATIONS: Record<
  string,
  { field: string; fallback: string | null }
> = {
  'providers.openaiApiKey': {
    field: 'providers.openaiBaseUrl',
    fallback: 'https://api.openai.com/v1'
  },
  'providers.azureOpenaiApiKey': {
    field: 'providers.azureOpenAiEndpoint',
    fallback: null
  },
  'providers.anthropicApiKey': {
    field: 'providers.anthropicBaseUrl',
    fallback: 'https://api.anthropic.com'
  },
  'providers.googleGeminiApiKey': {
    field: 'providers.googleGeminiBaseUrl',
    fallback: 'https://generativelanguage.googleapis.com/v1beta'
  },
  'providers.xAiApiKey': {
    field: 'providers.xAiBaseUrl',
    fallback: 'https://api.x.ai/v1'
  },
  'knowledgeBase.apiKey': { field: 'knowledgeBase.url', fallback: null }
}

/** The secret an address field carries, or `null` for any other field. */
export function destinationSecretOf(field: string): string | null {
  for (const [secret, dest] of Object.entries(SECRET_DESTINATIONS)) {
    if (dest.field === field) return secret
  }
  return null
}

const asUrl = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v : null

/**
 * The server's rule R1 on a settings write, applied to the payload before it
 * is posted: a key that comes back as its mask while its address moved is
 * cleared (the server would clear it anyway — a stored key never follows a
 * new host). Posting the `null` keeps the cached settings, and so the form,
 * in step with what is stored. Mutates `candidate`; returns the cleared paths.
 */
export function clearMovedSecrets(
  persisted: object,
  candidate: object
): string[] {
  const cleared: string[] = []
  for (const [secret, dest] of Object.entries(SECRET_DESTINATIONS)) {
    if (!looksLikeMask(get(candidate, secret))) continue
    const before = asUrl(get(persisted, dest.field)) ?? dest.fallback
    const after = asUrl(get(candidate, dest.field)) ?? dest.fallback
    if (normalizeBaseUrl(before) !== normalizeBaseUrl(after)) {
      set(candidate, secret, null)
      cleared.push(secret)
    }
  }
  return cleared
}
