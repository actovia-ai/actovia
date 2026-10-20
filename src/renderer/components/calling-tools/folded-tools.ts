import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { ChatToolResultMessage } from '@actovia/shared/types/chat'

/**
 * Card tools whose result folds into the thinking timeline instead of the
 * answer: a command run, a file written — the model working, not what it
 * says. The row keeps the call; the card opens under it on demand (owner,
 * 2026-10-06: the cards go into the scroll, as on the phone).
 */
export const FOLDED_TOOL_NAMES = new Set<string>([
  TOOL_NAMES.terminal,
  TOOL_NAMES.writeFile,
  TOOL_NAMES.editFile
])

/** Whether a tool's result is drawn in the timeline, under its call. */
export function foldsIntoTimeline(toolName: string): boolean {
  return FOLDED_TOOL_NAMES.has(toolName)
}

/**
 * The exit code a terminal result carries, for the folded row's badge. Null
 * when the result holds none (a row stored before the shape was fixed).
 */
export function terminalExitCode(result: ChatToolResultMessage): number | null {
  const output = structuredOutput(result)
  const code = output ? (output as { exitCode?: unknown }).exitCode : undefined
  return typeof code === 'number' ? code : null
}

/** The name of the file a write_file / edit_file result is about, for the row. */
export function foldedFileName(result: ChatToolResultMessage): string | null {
  const output = structuredOutput(result)
  const path = output ? (output as { path?: unknown }).path : undefined
  if (typeof path !== 'string' || path === '') return null
  return path.split('/').pop() || path
}

/**
 * A result's structured output: `details` when the row was stored with it,
 * else the JSON of its first text block (older rows). Null when neither is an
 * object.
 */
function structuredOutput(result: ChatToolResultMessage): object | null {
  if (result.details && typeof result.details === 'object')
    return result.details
  const text = result.content.find((c) => c.type === 'text')
  if (!text || text.type !== 'text') return null
  try {
    const parsed: unknown = JSON.parse(text.text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}
