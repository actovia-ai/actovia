export const PM_ROUND_EVENT_KINDS = [
  'input',
  'reports',
  'thinking',
  'text',
  'tool_call',
  'tool_result',
  'usage',
  'error'
] as const

export type PmRoundEventKind = (typeof PM_ROUND_EVENT_KINDS)[number]

/** One event of a PM round's decision trail, as the API sends it. */
export type PmRoundEventDto = {
  seq: number
  kind: PmRoundEventKind
  payload: Record<string, unknown>
  createdAt: string
}
