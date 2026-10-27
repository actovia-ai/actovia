/**
 * Token counting utilities.
 * Uses a character-based approximation (~3.5 chars/token) which is accurate
 * enough for LCM threshold triggers.
 */

const CHARS_PER_TOKEN = 3.5

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function estimateJsonTokens(value: unknown): number {
  return estimateTokens(JSON.stringify(value) ?? '')
}

// Overhead per message for role, structure, etc.
const MESSAGE_OVERHEAD = 8

export function estimateMessageTokens(content: unknown): number {
  return estimateJsonTokens(content) + MESSAGE_OVERHEAD
}

/**
 * What a picture counts in the context view (ISSUE-235): about a 2048 px
 * image after the shared fit. Its base64 length — a 3 MB attachment reads
 * as ~900k tokens — would crush every other part when scaled to the
 * provider's real input. LCM's own counting is unchanged.
 */
export const IMAGE_TOKEN_ALLOWANCE = 1600

/** `estimateMessageTokens`, except that an image part counts the allowance. */
export function estimateContentTokensForView(content: unknown): number {
  if (!Array.isArray(content)) return estimateMessageTokens(content)
  let tokens = MESSAGE_OVERHEAD
  for (const part of content) {
    tokens +=
      (part as { type?: unknown } | null)?.type === 'image'
        ? IMAGE_TOKEN_ALLOWANCE
        : estimateJsonTokens(part)
  }
  return tokens
}
