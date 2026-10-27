/**
 * What fills a chat's context, as of its last run (ISSUE-235): served by
 * `GET /api/v1/chat/:id/context`, drawn by the header's ring and the chat
 * panel's Context section.
 */
export type ContextPartKey =
  | 'system'
  | 'skills'
  | 'mcp'
  | 'tools'
  | 'memory'
  | 'summaries'
  | 'messages'

/** Every part, in the order they are drawn. */
export const CONTEXT_PART_KEYS: readonly ContextPartKey[] = [
  'system',
  'skills',
  'mcp',
  'tools',
  'memory',
  'summaries',
  'messages'
]

export interface ChatContextSnapshot {
  /** ISO time the run that measured it ended. */
  takenAt: string
  runId: string
  /** The model id the run went to. */
  model: string
  /** The model's window in tokens; 0 when unknown. */
  contextWindow: number
  /** Tokens of summaries + messages at which LCM compacts; null with LCM off. */
  compactAt: number | null
  total: number
  /** True when the provider reported no input size and the parts are estimates. */
  estimated: boolean
  /** Always all seven, in `CONTEXT_PART_KEYS` order. */
  parts: { key: ContextPartKey; tokens: number }[]
}
