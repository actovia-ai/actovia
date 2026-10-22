// src/main/lib/agents/claude-code/protocol.ts
import type {
  AgentQuestion,
  CliQuota,
  QuotaState
} from '@actovia/shared/types/agents'

import type { AgentEvent } from '../driver'
import { toMs } from '../epoch'

export interface ParsedLine {
  events: AgentEvent[]
  control?: {
    requestId: string
    toolName: string
    input: Record<string, unknown>
  }
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** One line of the tool's input: the path, the command, the pattern… */
export function summarizeInput(_tool: string, input: Json): string {
  const pick = [
    'file_path',
    'path',
    'notebook_path',
    'command',
    'pattern',
    'url',
    'query',
    'description'
  ]
    .map((k) => str(input[k]))
    .find((v) => v && v.trim())
  return (pick ?? '').split('\n')[0].slice(0, 160)
}

/**
 * The FULL text the owner judges when approving a tool: never cut, and no
 * key left out — what the main rendering does not consume (a key counts as
 * consumed only when its value is the string, or for `edits` the array, it
 * renders) is appended as JSON.
 */
export function describeInput(tool: string, input: Json): string {
  const strs = (o: Json, keys: string[]) =>
    keys.every((k) => str(o[k]) !== null)
  const without = (o: Json, keys: string[]): Json =>
    Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
  const edit = (e: Json) =>
    `--- old\n${str(e.old_string)}\n+++ new\n${str(e.new_string)}`
  const editOf = (e: unknown): string => {
    if (!isObj(e) || !strs(e, ['old_string', 'new_string']))
      return JSON.stringify(e, null, 2)
    const rest = without(e, ['old_string', 'new_string'])
    return Object.keys(rest).length
      ? `${edit(e)}\n  other fields: ${JSON.stringify(rest)}`
      : edit(e)
  }
  const path = (k = 'file_path') => str(input[k]) ?? ''
  let main: string
  let consumed: string[]
  if (tool === 'Bash' && strs(input, ['command'])) {
    main = str(input.command)!
    consumed = ['command']
  } else if (tool === 'Write') {
    consumed = ['file_path', 'content'].filter((k) => str(input[k]) !== null)
    main = `${path()}\n\n${str(input.content) ?? ''}`
  } else if (tool === 'Edit') {
    consumed = ['file_path', 'old_string', 'new_string'].filter(
      (k) => str(input[k]) !== null
    )
    main = `${path()}\n\n${str(input.old_string) !== null && str(input.new_string) !== null ? edit(input) : ''}`
    if (consumed.includes('old_string') !== consumed.includes('new_string'))
      consumed = consumed.filter((k) => k === 'file_path')
    // `replace_all: false` is Edit's default and says nothing to approve;
    // `true` changes what the edit does, so it stays in Other fields.
    if (input.replace_all === false) consumed.push('replace_all')
  } else if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    main = `${path()}\n\n${input.edits.map(editOf).join('\n\n')}`
    consumed = [
      'edits',
      ...(str(input.file_path) !== null ? ['file_path'] : [])
    ]
  } else {
    return JSON.stringify(input, null, 2)
  }
  const rest = without(input, consumed)
  return Object.keys(rest).length
    ? `${main}\n\nOther fields:\n${JSON.stringify(rest, null, 2)}`
    : main
}

function questions(input: Json): AgentQuestion[] {
  const qs = Array.isArray(input.questions) ? input.questions : []
  return qs.filter(isObj).map((q) => ({
    question: str(q.question) ?? '',
    header: str(q.header) ?? undefined,
    multiSelect: q.multiSelect === true,
    options: (Array.isArray(q.options) ? q.options : [])
      .filter(isObj)
      .map((o) => ({
        label: str(o.label) ?? '',
        description: str(o.description) ?? undefined
      }))
  }))
}

const STATES: Record<string, QuotaState> = {
  allowed: 'ok',
  allowed_warning: 'warning',
  rejected: 'rejected'
}

/** A model's own window is named after it: `seven_day_opus` → `opus`. */
const modelOfWindow = (name: string) =>
  /^(?:five_hour|seven_day)_([a-z][\w-]*)$/u.exec(name)?.[1]

/** `rate_limit_info` → the store's shape (spec 2026-10-16 §2). */
export function quotaFromClaudeInfo(info: Json, now: number): CliQuota | null {
  const status = str(info.status)
  if (!status) return null
  const windows: CliQuota['windows'] = []
  const add = (name: string, utilization: unknown, resetsAt: unknown) => {
    if (typeof utilization !== 'number') return
    const model = modelOfWindow(name)
    windows.push({
      name,
      usedPercent: Math.round(utilization * 1000) / 10,
      resetsAt: typeof resetsAt === 'number' ? toMs(resetsAt) : null,
      ...(model ? { model } : {})
    })
  }
  if (isObj(info.unifiedWindows))
    for (const [name, w] of Object.entries(info.unifiedWindows))
      if (isObj(w)) add(name, w.utilization, w.resetsAt)
  const type = str(info.rateLimitType)
  if (type && !windows.some((w) => w.name === type))
    add(type, info.utilization, info.resetsAt)
  const state = STATES[status] ?? 'ok'
  // The window it rejected on stays marked: a later reading of another model
  // does not name it, and the store keeps it until its reset.
  if (state === 'rejected' && type)
    for (const w of windows) if (w.name === type) w.rejected = true
  return {
    cli: 'claude-code',
    windows,
    state,
    rejectedWindow: state === 'rejected' ? type : null,
    overage: info.overageEnabled === true && info.overageStatus !== 'rejected',
    asOf: now
  }
}

export function parseLine(line: string): ParsedLine {
  let e: unknown
  try {
    e = JSON.parse(line)
  } catch {
    return { events: [] }
  }
  if (!isObj(e)) return { events: [] }

  switch (e.type) {
    case 'system':
      if (e.subtype === 'init' && str(e.session_id)) {
        return {
          events: [
            {
              type: 'init',
              cliSessionId: str(e.session_id)!,
              model: str(e.model)
            }
          ]
        }
      }
      return { events: [] }

    case 'stream_event': {
      const ev = isObj(e.event) ? e.event : null
      const delta = ev && isObj(ev.delta) ? ev.delta : null
      if (
        ev?.type === 'content_block_delta' &&
        delta?.type === 'text_delta' &&
        str(delta.text)
      ) {
        return { events: [{ type: 'text_delta', delta: str(delta.text)! }] }
      }
      return { events: [] }
    }

    case 'assistant': {
      const content =
        isObj(e.message) && Array.isArray(e.message.content)
          ? e.message.content
          : []
      const events: AgentEvent[] = []
      for (const b of content.filter(isObj)) {
        if (b.type === 'text' && str(b.text))
          events.push({ type: 'text', text: str(b.text)! })
        if (b.type === 'tool_use' && str(b.id) && str(b.name)) {
          const input = isObj(b.input) ? b.input : {}
          events.push({
            type: 'step_start',
            id: str(b.id)!,
            tool: str(b.name)!,
            summary: summarizeInput(str(b.name)!, input)
          })
        }
      }
      return { events }
    }

    case 'user': {
      const content =
        isObj(e.message) && Array.isArray(e.message.content)
          ? e.message.content
          : []
      return {
        events: content
          .filter(isObj)
          .filter((b) => b.type === 'tool_result' && str(b.tool_use_id))
          .map((b) => ({
            type: 'step_end' as const,
            id: str(b.tool_use_id)!,
            isError: b.is_error === true
          }))
      }
    }

    case 'control_request': {
      const req = isObj(e.request) ? e.request : {}
      const requestId = str(e.request_id)
      if (!requestId) return { events: [] }
      if (req.subtype !== 'can_use_tool') {
        return {
          events: [
            {
              type: 'notice',
              text: `Claude Code asked for “${String(req.subtype)}”, which Actovia cannot answer — continue in Terminal.`
            }
          ]
        }
      }
      const toolName = str(req.tool_name) ?? 'Tool'
      const input = isObj(req.input) ? req.input : {}
      const prompt =
        toolName === 'AskUserQuestion'
          ? {
              kind: 'question' as const,
              requestId,
              questions: questions(input)
            }
          : {
              kind: 'permission' as const,
              requestId,
              tool: toolName,
              summary: summarizeInput(toolName, input),
              detail: describeInput(toolName, input)
            }
      return {
        events: [{ type: 'blocked', prompt }],
        control: { requestId, toolName, input }
      }
    }

    case 'result':
      return {
        events: [
          {
            type: 'turn_end',
            ok: e.subtype === 'success' && e.is_error !== true,
            interrupted: false,
            text: str(e.result) ?? '',
            costUsd:
              typeof e.total_cost_usd === 'number' ? e.total_cost_usd : null,
            denials: Array.isArray(e.permission_denials)
              ? e.permission_denials.length
              : 0
          }
        ]
      }

    case 'rate_limit_event': {
      const info = isObj(e.rate_limit_info) ? e.rate_limit_info : {}
      const quota = quotaFromClaudeInfo(info, Date.now())
      const events: AgentEvent[] = quota ? [{ type: 'quota', quota }] : []
      if (info.status === 'allowed' || !str(info.status)) return { events }
      const resets =
        typeof info.resetsAt === 'number'
          ? ` · resets ${new Date(toMs(info.resetsAt)).toLocaleString()}`
          : ''
      events.push({
        type: 'notice',
        text: `Rate limit (${str(info.rateLimitType) ?? 'usage'}): ${str(info.status)}${resets}`
      })
      return { events }
    }

    default:
      return { events: [] }
  }
}
