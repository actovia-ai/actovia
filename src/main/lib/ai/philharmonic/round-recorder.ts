// The PM's decision trail (spec 2026-10-17 §2): every agentLoop event of a
// round that tells why it did what it did, in order, masked, written as it
// happens. Best-effort: a failed write is logged and never fails the round.
import type { PmRoundEventKind } from '@actovia/shared/types/pm-round'

import { appendRoundEvent } from '../../db/pm-round-queries'
import { logger } from '../../logger'
import { maskLogText } from '../../logger/secret-mask'

export interface RoundRecorderDeps {
  append(e: {
    conversationId: string
    roundId: string
    seq: number
    kind: PmRoundEventKind
    payload: Record<string, unknown>
  }): Promise<void>
  mask(text: string): string
}

export interface RoundRecorder {
  readonly roundId: string
  input(trigger: 'user' | 'scheduled', text: string): void
  reports(
    messages: Array<{ messageId: string; agentId: string | null; name: string }>
  ): void
  /** Feed every agentLoop event; the recorder keeps what the trail needs. */
  onEvent(event: unknown): void
  error(message: string, aborted: boolean): void
  /** Writes `usage` (when any message carried one), waits for every write, and returns the round's counts. Never throws. */
  finish(): Promise<{ delegations: number; waits: number }>
}

const defaultDeps: RoundRecorderDeps = {
  append: appendRoundEvent,
  mask: maskLogText
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** What the PM read back from a tool, as text. */
export function resultText(result: unknown): string {
  if (result == null) return ''
  if (typeof result === 'string') return result
  if (isObj(result) && Array.isArray(result.content)) {
    const text = result.content
      .filter(
        (c): c is { type: 'text'; text: string } =>
          isObj(c) && c.type === 'text' && typeof c.text === 'string'
      )
      .map((c) => c.text)
      .join('')
    if (text) return text
  }
  try {
    return JSON.stringify(result) ?? String(result)
  } catch {
    return String(result)
  }
}

function maskDeep(
  v: unknown,
  mask: (t: string) => string,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (typeof v === 'string') return mask(v)
  if (typeof v === 'object' && v !== null) {
    if (seen.has(v)) return '[circular]'
    seen.add(v)
    try {
      if (Array.isArray(v)) return v.map((x) => maskDeep(x, mask, seen))
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, maskDeep(x, mask, seen)])
      )
    } finally {
      seen.delete(v)
    }
  }
  return v
}

export function createRoundRecorder(
  conversationId: string,
  roundId: string,
  deps: RoundRecorderDeps = defaultDeps
): RoundRecorder {
  let seq = 0
  let chain: Promise<void> = Promise.resolve()
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    seen: false
  }
  const counts = { delegations: 0, waits: 0 }

  const captureFailed = (error: unknown) => {
    try {
      logger.warn('philharmonic', 'decision trail capture failed', {
        conversationId,
        roundId,
        error
      })
    } catch {
      // a broken logger must not reach the round either
    }
  }

  const write = (kind: PmRoundEventKind, payload: Json) => {
    try {
      const masked = maskDeep(payload, deps.mask) as Json
      const row = { conversationId, roundId, seq: seq++, kind, payload: masked }
      chain = chain.then(() =>
        Promise.resolve()
          .then(() => deps.append(row))
          .catch((error) =>
            logger.warn('philharmonic', 'decision trail write failed', {
              conversationId,
              roundId,
              kind,
              error
            })
          )
      )
    } catch (error) {
      captureFailed(error)
    }
  }

  return {
    roundId,
    input: (trigger, text) => write('input', { trigger, text }),
    reports: (messages) => {
      if (messages.length > 0) write('reports', { messages })
    },
    onEvent(event) {
      try {
        handle(event)
      } catch (error) {
        captureFailed(error)
      }
    },
    error: (message, aborted) => write('error', { message, aborted }),
    async finish() {
      try {
        if (usage.seen) {
          const { seen: _seen, ...rest } = usage
          write('usage', {
            ...rest,
            costUsd: Math.round(rest.costUsd * 1e6) / 1e6
          })
        }
      } catch (error) {
        captureFailed(error)
      }
      await chain.catch(() => {})
      return { ...counts }
    }
  }

  function handle(event: unknown) {
    if (!isObj(event)) return
    if (
      event.type === 'message_end' &&
      isObj(event.message) &&
      event.message.role === 'assistant'
    ) {
      const msg = event.message
      for (const part of Array.isArray(msg.content) ? msg.content : []) {
        if (!isObj(part)) continue
        if (
          part.type === 'thinking' &&
          typeof part.thinking === 'string' &&
          part.thinking.trim()
        )
          write('thinking', { text: part.thinking })
        else if (
          part.type === 'text' &&
          typeof part.text === 'string' &&
          part.text.trim()
        )
          write('text', { text: part.text })
      }
      const u = isObj(msg.usage) ? msg.usage : null
      if (u) {
        usage.seen = true
        usage.inputTokens += typeof u.input === 'number' ? u.input : 0
        usage.outputTokens += typeof u.output === 'number' ? u.output : 0
        usage.cacheReadTokens +=
          typeof u.cacheRead === 'number' ? u.cacheRead : 0
        usage.costUsd +=
          isObj(u.cost) && typeof u.cost.total === 'number' ? u.cost.total : 0
      }
    } else if (event.type === 'tool_execution_start') {
      write('tool_call', {
        toolCallId: event.toolCallId,
        name: event.toolName,
        args: event.args ?? {}
      })
    } else if (event.type === 'tool_execution_end') {
      const text = resultText(event.result)
      const ok = event.isError !== true
      if (
        ok &&
        event.toolName === 'delegateTask' &&
        !text.startsWith('Not started:')
      )
        counts.delegations++
      if (
        ok &&
        event.toolName === 'waitForQuota' &&
        !text.startsWith('Refused')
      )
        counts.waits++
      write('tool_result', {
        toolCallId: event.toolCallId,
        name: event.toolName,
        text,
        isError: !ok
      })
    }
  }
}
