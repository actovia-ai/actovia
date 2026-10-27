// src/main/lib/agents/codex/protocol.ts
import type { AgentQuestion, CliQuota } from '@actovia/shared/types/agents'

import type { AgentEvent } from '../driver'
import { toMs } from '../epoch'

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/**
 * `account/rateLimits/read`'s result, or an `updated` notification's params
 * (a sparse snapshot — spec 2026-10-16 §2). A bucket of its own (a model with
 * its own quota) gets its windows prefixed with its name and marked with its model.
 */
export function quotaFromCodex(body: Json, now: number): CliQuota | null {
  const windows: CliQuota['windows'] = []
  let reached = false
  let overage = false
  const accountStopped = body.ordinaryUsageAllowed === false
  const take = (snap: unknown, prefix: string) => {
    if (!isObj(snap)) return
    const bucketReached = snap.rateLimitReachedType != null
    if (bucketReached) reached = true
    if (isObj(snap.credits))
      overage ||=
        snap.credits.hasCredits === true || snap.credits.unlimited === true
    const model = str(snap.normalModelSlug) ?? undefined
    for (const k of ['primary', 'secondary'] as const) {
      const w = snap[k]
      if (!isObj(w) || typeof w.usedPercent !== 'number') continue
      const rejected =
        (bucketReached && w.usedPercent >= 100) || (!prefix && accountStopped)
      windows.push({
        name: prefix ? `${prefix} ${k}` : k,
        usedPercent: w.usedPercent,
        resetsAt: typeof w.resetsAt === 'number' ? toMs(w.resetsAt) : null,
        ...(typeof w.windowDurationMins === 'number'
          ? { durationMins: w.windowDurationMins }
          : {}),
        ...(prefix && model ? { model } : {}),
        ...(rejected ? { rejected: true } : {})
      })
    }
  }
  const main = isObj(body.rateLimits) ? body.rateLimits : null
  take(main, '')
  if (isObj(body.rateLimitsByLimitId))
    for (const [id, snap] of Object.entries(body.rateLimitsByLimitId)) {
      if (!isObj(snap) || id === (main && str(main.limitId))) continue
      take(snap, str(snap.limitName) ?? id)
    }
  if (!windows.length && !reached && !accountStopped) return null
  const state = reached || accountStopped ? 'rejected' : 'ok'
  return {
    cli: 'codex',
    windows,
    state,
    rejectedWindow:
      state === 'rejected'
        ? (windows.find((w) => w.usedPercent >= 100)?.name ?? null)
        : null,
    overage,
    asOf: now
  }
}

export type PendingKind = 'command' | 'fileChange' | 'permissions' | 'userInput'
export interface PendingRequest {
  rpcId: number | string
  /** `${nonce}:${rpcId}`: Codex numbers its requests from 0 in every process. */
  requestId: string
  kind: PendingKind
  params: Json
}
export interface Refusal {
  rpcId: number | string
  result?: unknown
  error?: { code: number; message: string }
}
export interface ParsedMessage {
  events: AgentEvent[]
  pending?: PendingRequest
  refusal?: Refusal
  response?: {
    id: number | string
    result?: unknown
    error?: { code?: number; message?: string }
  }
  turnId?: string
  /** A server request Codex resolved itself (a cancelled turn, a timeout), keyed as `requestId`. */
  resolved?: string
}
export interface FileChange {
  path: string
  kind: { type: string; move_path?: string | null }
  diff: string
}
export interface CodexParser {
  setThread(id: string, model: string | null): void
  parse(line: string): ParsedMessage
}

/** Routing and suggestion fields — not what the owner approves. */
const META = new Set([
  'threadId',
  'turnId',
  'itemId',
  'startedAtMs',
  'approvalId',
  'availableDecisions',
  'proposedExecpolicyAmendment',
  'proposedNetworkPolicyAmendments',
  'commandActions'
])

function rest(params: Json, consumed: string[]): string {
  const left = Object.fromEntries(
    Object.entries(params).filter(
      ([k, v]) => !META.has(k) && !consumed.includes(k) && v != null
    )
  )
  return Object.keys(left).length
    ? `\n\nOther fields:\n${JSON.stringify(left, null, 2)}`
    : ''
}

export function describeCommand(params: Json): string {
  const command = str(params.command) ?? '(no command given)'
  const cwd = str(params.cwd)
  const reason = str(params.reason)
  const lead =
    params.kind === 'writeStdin'
      ? 'Sends this input to a command that is already running:\n'
      : ''
  return `${lead}${command}${cwd ? `\n\nin ${cwd}` : ''}${reason ? `\n\nReason: ${reason}` : ''}${rest(params, ['command', 'cwd', 'reason', 'kind'])}`
}

const KIND: Record<string, string> = {
  add: 'Add',
  delete: 'Delete',
  update: 'Update'
}

export function describeFileChange(
  params: Json,
  changes: FileChange[] | undefined
): string {
  const reason = str(params.reason)
  const grantRoot = str(params.grantRoot)
  const body = changes?.length
    ? changes
        .map(
          (c) =>
            `${KIND[c.kind.type] ?? c.kind.type} ${c.path}${c.kind.move_path ? ` → ${c.kind.move_path}` : ''}\n${c.diff}`
        )
        .join('\n\n')
    : 'The change wasn’t shown to Actovia — Deny unless you expected it.'
  return `${body}${grantRoot ? `\n\nAlso asks to allow writes under ${grantRoot}.` : ''}${reason ? `\n\nReason: ${reason}` : ''}${rest(params, ['reason', 'grantRoot'])}`
}

export function describePermissions(params: Json): string {
  const reason = str(params.reason)
  const cwd = str(params.cwd)
  return `${reason ? `${reason}\n\n` : ''}Asks for:\n${JSON.stringify(params.permissions ?? null, null, 2)}${cwd ? `\n\nin ${cwd}` : ''}${rest(params, ['reason', 'cwd', 'permissions'])}`
}

const firstLine = (s: string) => s.split('\n')[0].slice(0, 160)

function stepOf(item: Json): { tool: string; summary: string } | null {
  switch (item.type) {
    case 'commandExecution': {
      const action =
        Array.isArray(item.commandActions) && isObj(item.commandActions[0])
          ? str(item.commandActions[0].command)
          : null
      return {
        tool: 'Bash',
        summary: firstLine(action ?? str(item.command) ?? '')
      }
    }
    case 'fileChange': {
      const changes = Array.isArray(item.changes)
        ? item.changes.filter(isObj)
        : []
      const first = str(changes[0]?.path) ?? ''
      return {
        tool: 'Edit',
        summary:
          changes.length > 1 ? `${first} (+${changes.length - 1})` : first
      }
    }
    case 'mcpToolCall':
      return {
        tool: `${str(item.server) ?? 'mcp'}.${str(item.tool) ?? 'tool'}`,
        summary: ''
      }
    case 'webSearch':
      return { tool: 'WebSearch', summary: firstLine(str(item.query) ?? '') }
    default:
      return null
  }
}

function questionsOf(params: Json): AgentQuestion[] {
  const qs = Array.isArray(params.questions)
    ? params.questions.filter(isObj)
    : []
  return qs.map((q) => ({
    id: str(q.id) ?? undefined,
    question: str(q.question) ?? '',
    header: str(q.header) ?? undefined,
    multiSelect: false,
    isOther: q.isOther === true || q.options == null,
    isSecret: q.isSecret === true,
    options: (Array.isArray(q.options) ? q.options.filter(isObj) : []).map(
      (o) => ({
        label: str(o.label) ?? '',
        description: str(o.description) ?? undefined
      })
    )
  }))
}

/** What a request from another thread is told: the owner never saw it. */
const DECLINED: Partial<Record<string, unknown>> = {
  'item/commandExecution/requestApproval': { decision: 'decline' },
  'item/fileChange/requestApproval': { decision: 'decline' },
  'item/permissions/requestApproval': { permissions: {}, scope: 'turn' },
  'item/tool/requestUserInput': { answers: {} }
}

/**
 * `nonce` prefixes every request id, so an answer meant for another process
 * (whose ids also start at 0) never matches one of this process's requests.
 */
export function createCodexParser(nonce: string): CodexParser {
  let threadId = ''
  let model: string | null = null
  const fileChanges = new Map<string, FileChange[]>()
  let lastText = ''
  let declined = 0
  const openSteps = new Set<string>()

  const notice = (text: string): AgentEvent => ({ type: 'notice', text })
  /** Names a thread, and not this run's (none is known before `setThread`). */
  const foreign = (params: Json) =>
    threadId !== '' &&
    typeof params.threadId === 'string' &&
    params.threadId !== threadId

  function serverRequest(
    rpcId: number | string,
    method: string,
    params: Json
  ): ParsedMessage {
    const requestId = `${nonce}:${rpcId}`
    if (foreign(params)) {
      const refused = DECLINED[method]
      return {
        events: [
          notice(
            `Codex asked for “${method}” on another thread; Actovia declined it.`
          )
        ],
        refusal: refused
          ? { rpcId, result: refused }
          : {
              rpcId,
              error: {
                code: -32601,
                message: `Actovia does not handle ${method} for another thread`
              }
            }
      }
    }
    switch (method) {
      case 'item/commandExecution/requestApproval':
        return {
          events: [
            {
              type: 'blocked',
              prompt: {
                kind: 'permission',
                requestId,
                tool: params.kind === 'writeStdin' ? 'Stdin' : 'Bash',
                summary:
                  params.kind === 'writeStdin'
                    ? 'Input to a running command'
                    : str(params.command)
                      ? firstLine(str(params.command)!)
                      : isObj(params.networkApprovalContext)
                        ? `Network access${str(params.networkApprovalContext.host) ? ` to ${str(params.networkApprovalContext.host)}` : ''}`
                        : '',
                detail: describeCommand(params)
              }
            }
          ],
          pending: { rpcId, requestId, kind: 'command', params }
        }
      case 'item/fileChange/requestApproval': {
        const changes = fileChanges.get(str(params.itemId) ?? '')
        return {
          events: [
            {
              type: 'blocked',
              prompt: {
                kind: 'permission',
                requestId,
                tool: 'Edit',
                summary: str(changes?.[0]?.path) ?? '',
                detail: describeFileChange(params, changes)
              }
            }
          ],
          pending: { rpcId, requestId, kind: 'fileChange', params }
        }
      }
      case 'item/permissions/requestApproval':
        return {
          events: [
            {
              type: 'blocked',
              prompt: {
                kind: 'permission',
                requestId,
                tool: 'Permissions',
                summary: firstLine(str(params.reason) ?? 'More access'),
                detail: describePermissions(params)
              }
            }
          ],
          pending: { rpcId, requestId, kind: 'permissions', params }
        }
      case 'item/tool/requestUserInput':
        return {
          events: [
            {
              type: 'blocked',
              prompt: {
                kind: 'question',
                requestId,
                questions: questionsOf(params)
              }
            }
          ],
          pending: { rpcId, requestId, kind: 'userInput', params }
        }
      case 'mcpServer/elicitation/request':
        return {
          events: [
            notice(
              'Codex asked something on behalf of an MCP server, which Actovia can’t answer — continue in Terminal.'
            )
          ],
          refusal: { rpcId, result: { action: 'decline', content: null } }
        }
      default:
        return {
          events: [
            notice(
              `Codex asked for “${method}”, which Actovia can’t answer — continue in Terminal.`
            )
          ],
          refusal: {
            rpcId,
            error: {
              code: -32601,
              message: `Actovia does not handle ${method}`
            }
          }
        }
    }
  }

  return {
    setThread(id, m) {
      threadId = id
      model = m
    },
    parse(line) {
      let m: unknown
      try {
        m = JSON.parse(line)
      } catch {
        return { events: [] }
      }
      if (!isObj(m)) return { events: [] }
      const id =
        typeof m.id === 'number' || typeof m.id === 'string' ? m.id : null
      const method = str(m.method)
      const params = isObj(m.params) ? m.params : {}
      if (id !== null && !method) {
        return {
          events: [],
          response: {
            id,
            ...('result' in m ? { result: m.result } : {}),
            ...(isObj(m.error)
              ? { error: m.error as { code?: number; message?: string } }
              : {})
          }
        }
      }
      if (id !== null && method) return serverRequest(id, method, params)
      // Another thread's turn must never start, fill or end this run's.
      if (
        (method?.startsWith('turn/') || method?.startsWith('item/')) &&
        foreign(params)
      )
        return { events: [] }
      const item = isObj(params.item) ? params.item : null
      switch (method) {
        case 'turn/started': {
          const turn = isObj(params.turn) ? params.turn : {}
          return {
            events: [{ type: 'init', cliSessionId: threadId, model }],
            turnId: str(turn.id) ?? undefined
          }
        }
        case 'item/agentMessage/delta':
          return str(params.delta)
            ? { events: [{ type: 'text_delta', delta: str(params.delta)! }] }
            : { events: [] }
        case 'item/started': {
          if (!item || !str(item.id)) return { events: [] }
          if (item.type === 'fileChange' && Array.isArray(item.changes))
            fileChanges.set(
              str(item.id)!,
              item.changes.filter(isObj) as unknown as FileChange[]
            )
          const step = stepOf(item)
          if (step) openSteps.add(str(item.id)!)
          return step
            ? { events: [{ type: 'step_start', id: str(item.id)!, ...step }] }
            : { events: [] }
        }
        case 'item/completed': {
          if (!item || !str(item.id)) return { events: [] }
          if (item.type === 'agentMessage') {
            const text = str(item.text) ?? ''
            if (!text) return { events: [] }
            lastText = text
            return { events: [{ type: 'text', text }] }
          }
          fileChanges.delete(str(item.id)!)
          if (!stepOf(item)) return { events: [] }
          openSteps.delete(str(item.id)!)
          if (item.status === 'declined') declined++
          return {
            events: [
              {
                type: 'step_end',
                id: str(item.id)!,
                isError: item.status === 'failed' || item.status === 'declined'
              }
            ]
          }
        }
        case 'turn/completed': {
          const turn = isObj(params.turn) ? params.turn : {}
          const status = str(turn.status)
          const error = isObj(turn.error) ? str(turn.error.message) : null
          const closing: AgentEvent[] = [...openSteps].map((sid) => ({
            type: 'step_end',
            id: sid,
            isError: true
          }))
          openSteps.clear()
          fileChanges.clear()
          const event: AgentEvent = {
            type: 'turn_end',
            ok: status === 'completed',
            interrupted: status === 'interrupted',
            text: status === 'failed' ? (error ?? lastText) : lastText,
            denials: declined
          }
          lastText = ''
          declined = 0
          return { events: [...closing, event] }
        }
        case 'item/fileChange/patchUpdated': {
          const iid = str(params.itemId)
          if (iid && Array.isArray(params.changes))
            fileChanges.set(
              iid,
              params.changes.filter(isObj) as unknown as FileChange[]
            )
          return { events: [] }
        }
        case 'serverRequest/resolved': {
          const rid = params.requestId
          return typeof rid === 'number' || typeof rid === 'string'
            ? { events: [], resolved: `${nonce}:${rid}` }
            : { events: [] }
        }
        case 'error':
          if (params.willRetry === true) return { events: [] }
          return {
            events: [
              notice(
                str(params.message) ??
                  (isObj(params.error)
                    ? (str(params.error.message) ?? 'Codex reported an error')
                    : 'Codex reported an error')
              )
            ]
          }
        case 'account/rateLimits/updated': {
          const limits = isObj(params.rateLimits) ? params.rateLimits : {}
          const quota = quotaFromCodex({ rateLimits: limits }, Date.now())
          const events: AgentEvent[] = quota
            ? [{ type: 'quota', quota, merge: true }]
            : []
          const full = ['primary', 'secondary'].some(
            (k) =>
              isObj(limits[k]) &&
              typeof (limits[k] as Json).usedPercent === 'number' &&
              ((limits[k] as Json).usedPercent as number) >= 100
          )
          if (full)
            events.push(notice(`Rate limit reached: ${JSON.stringify(limits)}`))
          return { events }
        }
        default:
          return { events: [] }
      }
    }
  }
}
