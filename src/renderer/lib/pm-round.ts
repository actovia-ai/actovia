import type { PmRoundEventDto } from '@actovia/shared/types/pm-round'

export type RoundLine =
  | { kind: 'trigger'; scheduled: boolean; text: string }
  | {
      kind: 'reports'
      reports: Array<{
        messageId: string
        agentId: string | null
        name: string
      }>
    }
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | {
      kind: 'call'
      tool: string
      args: Record<string, unknown>
      result: string | null
      isError: boolean
      refused: boolean
    }
  | {
      kind: 'usage'
      inputTokens: number
      outputTokens: number
    }
  | { kind: 'error'; message: string; aborted: boolean }

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' ? v : 0)

/**
 * A call the coordinator turned away: a delegation the quota guard stopped
 * ("Not started: …", pm-coordinator's onDelegate), or a `waitForQuota` it
 * refused ("Refused: …").
 */
const isRefused = (tool: string, result: string | null) =>
  result !== null &&
  ((tool === 'delegateTask' && result.startsWith('Not started:')) ||
    (tool === 'waitForQuota' && result.startsWith('Refused')))

/** Why a `waitForQuota` was refused: its result after "Refused: ". */
export function waitRefusalReason(result: string | null): string {
  if (!result) return ''
  return result.replace(/^Refused:?\s*/u, '')
}

/** When a scheduled wait wakes the PM: the text after "woken at ", up to the next ".". */
export function wakeTimeOf(result: string | null): string | null {
  const m = result?.match(/woken at ([^.]*)\./u)
  return m ? m[1].trim() || null : null
}

/** A round as the disclosure draws it: each call paired with its result; a trailing text equal to the bubble left out. */
export function describeRound(
  events: PmRoundEventDto[],
  bubbleText: string
): RoundLine[] {
  const results = new Map<string, { text: string; isError: boolean }>()
  for (const e of events)
    if (e.kind === 'tool_result')
      results.set(str(e.payload.toolCallId), {
        text: str(e.payload.text),
        isError: e.payload.isError === true
      })

  const lines: RoundLine[] = []
  for (const { kind, payload: p } of events) {
    switch (kind) {
      case 'input':
        lines.push({
          kind: 'trigger',
          scheduled: p.trigger === 'scheduled',
          text: str(p.text)
        })
        break
      case 'reports': {
        const messages = Array.isArray(p.messages) ? p.messages : []
        lines.push({
          kind: 'reports',
          reports: messages.map((m: Record<string, unknown>) => ({
            messageId: str(m.messageId),
            agentId: typeof m.agentId === 'string' ? m.agentId : null,
            name: str(m.name)
          }))
        })
        break
      }
      case 'thinking':
      case 'text':
        lines.push({ kind, text: str(p.text) })
        break
      case 'tool_call': {
        const tool = str(p.name)
        const r = results.get(str(p.toolCallId))
        const result = r?.text ?? null
        lines.push({
          kind: 'call',
          tool,
          args:
            typeof p.args === 'object' && p.args !== null
              ? (p.args as Record<string, unknown>)
              : {},
          result,
          isError: r?.isError ?? false,
          refused: isRefused(tool, result)
        })
        break
      }
      case 'usage':
        lines.push({
          kind: 'usage',
          // What the model read, the cached part included — Anthropic
          // reports a long prompt's cached prefix apart from `input`, which
          // alone read '14 in' for a round of 32k tokens.
          inputTokens:
            num(p.inputTokens) +
            num(p.cacheReadTokens) +
            num(p.cacheWriteTokens),
          outputTokens: num(p.outputTokens)
        })
        break
      case 'error':
        lines.push({
          kind: 'error',
          message: str(p.message),
          aborted: p.aborted === true
        })
        break
      case 'tool_result':
        break
    }
  }

  // The bubble already shows the round's final words; don't repeat them.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line.kind !== 'text') continue
    if (line.text.trim() === bubbleText.trim()) lines.splice(i, 1)
    break
  }
  return lines
}

export function roundCounts(events: PmRoundEventDto[]): {
  delegations: number
  waits: number
} {
  let delegations = 0
  let waits = 0
  for (const line of describeRound(events, '')) {
    if (line.kind !== 'call') continue
    if (line.tool === 'delegateTask' && !line.refused) delegations++
    if (line.tool === 'waitForQuota' && !line.refused) waits++
  }
  return { delegations, waits }
}
