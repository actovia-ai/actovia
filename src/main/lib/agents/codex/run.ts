// src/main/lib/agents/codex/run.ts
import { randomUUID } from 'crypto'

import type { AgentAnswer, PermissionMode } from '@exodus/shared/types/agents'

import type { AgentEvent, AgentRun, StartInput } from '../driver'
import { superviseProcess } from '../process'
import { createCodexParser, type PendingRequest } from './protocol'

/** Spec §4: Exodus' modes by meaning; the sandbox is always workspace-write. */
export const CODEX_APPROVAL: Record<
  PermissionMode,
  'untrusted' | 'on-request' | 'never'
> = {
  default: 'untrusted',
  acceptEdits: 'on-request',
  auto: 'never'
}

type Json = Record<string, unknown>

/** What Codex reads back for the owner's answer to `p` (approvals: accept/decline only). */
function reply(p: PendingRequest, answer: AgentAnswer): Json {
  if (p.kind === 'command' || p.kind === 'fileChange')
    return { decision: answer.kind === 'allow' ? 'accept' : 'decline' }
  if (p.kind === 'permissions') {
    const asked = (p.params.permissions ?? {}) as Json
    const granted = Object.fromEntries(
      Object.entries(asked).filter(([, v]) => v !== null && v !== undefined)
    )
    return {
      permissions: answer.kind === 'allow' ? granted : {},
      scope: 'turn'
    }
  }
  const given = answer.kind === 'answers' ? answer.answers : {}
  const questions = Array.isArray(p.params.questions)
    ? (p.params.questions as Json[])
    : []
  return {
    answers: Object.fromEntries(
      questions
        .map((q) => (typeof q?.id === 'string' ? q.id : ''))
        .filter((id) => id && given[id] !== undefined)
        .map((id) => [
          id,
          { answers: Array.isArray(given[id]) ? given[id] : [given[id]] }
        ])
    )
  }
}

interface ThreadResponse {
  thread?: { id?: unknown }
  model?: unknown
  approvalPolicy?: unknown
  approvalsReviewer?: unknown
  sandbox?: { type?: unknown; networkAccess?: unknown } | null
}

/** What Codex reports it will do that Exodus did not ask for, in its own words. */
function overrides(r: ThreadResponse, approvalPolicy: string): string[] {
  const out: string[] = []
  if (r.approvalPolicy !== approvalPolicy)
    out.push(`approval policy ${JSON.stringify(r.approvalPolicy ?? null)}`)
  if (r.approvalsReviewer !== 'user')
    out.push(
      `approvals reviewer ${JSON.stringify(r.approvalsReviewer ?? null)}`
    )
  if (r.sandbox?.type !== 'workspaceWrite')
    out.push(`sandbox ${JSON.stringify(r.sandbox?.type ?? null)}`)
  else if (r.sandbox.networkAccess !== false) out.push('network access on')
  return out
}

/** One `codex app-server` process (spec §3). Never throws: failures arrive as `exit`. */
export function startCodex(input: StartInput): AgentRun {
  const listeners = new Set<(e: AgentEvent) => void>()
  const emit = (e: AgentEvent) => {
    for (const l of Array.from(listeners)) l(e)
  }
  const parser = createCodexParser(randomUUID().slice(0, 8))
  const pending = new Map<string, PendingRequest>()
  const waiting = new Map<
    number,
    { ok(result: unknown): void; no(err: Error): void }
  >()
  const queue: string[] = []
  let nextId = 1
  let threadId: string | null = null
  let turnId: string | null = null
  let ready = false
  let busy = false
  let stopping = false
  // Stop was pressed for the turn in progress; sent once its id is known.
  let interruptWanted = false
  // The turn a `turn/interrupt` already went to — never a second one.
  let interruptedTurn: string | null = null

  const endTurn = () => {
    busy = false
    turnId = null
    interruptWanted = false
    interruptedTurn = null
    pending.clear()
  }

  const proc = superviseProcess({
    binPath: input.binPath,
    args: ['app-server'],
    cwd: input.cwd,
    env: input.env,
    logPath: input.logPath,
    onLine(line) {
      const parsed = parser.parse(line)
      if (parsed.response) {
        const id = Number(parsed.response.id)
        const w = waiting.get(id)
        waiting.delete(id)
        if (parsed.response.error)
          w?.no(
            new Error(
              parsed.response.error.message ?? 'Codex refused the request'
            )
          )
        else w?.ok(parsed.response.result)
      }
      if (parsed.refusal)
        proc.write({
          id: parsed.refusal.rpcId,
          ...(parsed.refusal.error
            ? { error: parsed.refusal.error }
            : { result: parsed.refusal.result })
        })
      if (parsed.pending) pending.set(parsed.pending.requestId, parsed.pending)
      // Codex settled it itself (a cancelled turn, a timeout): the prompt goes.
      if (parsed.resolved && pending.delete(parsed.resolved))
        emit({ type: 'answered', requestId: parsed.resolved })
      if (parsed.turnId) learnTurn(parsed.turnId)
      for (const e of parsed.events) {
        if (e.type === 'init') busy = true
        if (e.type === 'turn_end') endTurn()
        emit(e)
      }
    },
    onExit(info) {
      busy = false
      pending.clear()
      for (const w of waiting.values()) w.no(new Error('Codex exited'))
      waiting.clear()
      emit({ type: 'exit', ...info })
    }
  })

  const request = (method: string, params: unknown): Promise<unknown> =>
    new Promise((ok, no) => {
      const id = nextId++
      waiting.set(id, { ok, no })
      if (!proc.write({ id, method, params })) {
        waiting.delete(id)
        no(new Error('Codex is not running'))
      }
    })

  function learnTurn(id: string) {
    if (turnId) return
    turnId = id
    sendInterrupt()
  }

  function sendInterrupt() {
    if (!interruptWanted || !threadId || !turnId) return
    interruptWanted = false
    if (interruptedTurn === turnId) return
    interruptedTurn = turnId
    void request('turn/interrupt', { threadId, turnId }).catch(() => {})
  }

  const sendTurn = (text: string) => {
    request('turn/start', {
      threadId,
      input: [{ type: 'text', text, text_elements: [] }]
    }).then(
      (r) => {
        const id = (r as { turn?: { id?: unknown } } | null)?.turn?.id
        // Its turn may be over already (then `busy` is false): nothing to learn.
        if (typeof id === 'string' && busy) learnTurn(id)
      },
      (err: Error) => {
        if (!proc.alive) return
        // No turn will start, so none will end: end this one here.
        endTurn()
        emit({ type: 'notice', text: `Codex refused the task: ${err.message}` })
        emit({
          type: 'turn_end',
          ok: false,
          interrupted: false,
          text: '',
          costUsd: null,
          denials: 0
        })
      }
    )
  }

  const approvalPolicy = CODEX_APPROVAL[input.permissionMode]
  // Pinned whatever ~/.codex/config.toml says: approvals reach the owner, and
  // the sandbox is what the modes' texts describe.
  const threadParams = {
    cwd: input.cwd,
    approvalPolicy,
    approvalsReviewer: 'user',
    sandbox: 'workspace-write',
    config: { 'sandbox_workspace_write.network_access': false },
    ...(input.model ? { model: input.model } : {})
  }

  void (async () => {
    try {
      await request('initialize', {
        clientInfo: { name: 'exodus', title: 'Actovia', version: '1' },
        capabilities: null
      })
      proc.write({ method: 'initialized' })
      const r = (await request(
        input.resume ? 'thread/resume' : 'thread/start',
        input.resume
          ? { threadId: input.resume, ...threadParams }
          : threadParams
      )) as ThreadResponse | null
      threadId = typeof r?.thread?.id === 'string' ? r.thread.id : null
      if (!threadId) throw new Error('Codex started no thread')
      const overridden = overrides(r!, approvalPolicy)
      if (overridden.length > 0) {
        // A managed (enterprise) config wins over thread params: never run under it.
        emit({
          type: 'notice',
          text: `Codex reported ${overridden.join(', ')} — not what Actovia asked for. A managed or enterprise Codex configuration overrides it, so Actovia won’t run this step.`
        })
        throw new Error(
          `Codex overrode Actovia’s approval settings: ${overridden.join(', ')}`
        )
      }
      parser.setThread(
        threadId,
        typeof r?.model === 'string' ? r.model : (input.model ?? null)
      )
      ready = true
      for (const text of queue.splice(0)) sendTurn(text)
    } catch (err) {
      // A Stop during the handshake breaks it on purpose: that exit is a stop.
      if (stopping) return
      await proc.fail(err instanceof Error ? err.message : String(err))
    }
  })()

  return {
    get cliSessionId() {
      return threadId
    },
    get alive() {
      return proc.alive
    },
    get busy() {
      return busy && proc.alive
    },
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    send(text) {
      // One turn at a time: a refused turn/start must never end another's turn.
      if (!proc.alive || busy) return false
      busy = true
      if (ready) sendTurn(text)
      else queue.push(text)
      return true
    },
    respond(requestId, answer) {
      const p = pending.get(requestId)
      if (!p || !proc.alive) return false
      if (!proc.write({ id: p.rpcId, result: reply(p, answer) })) return false
      pending.delete(requestId)
      emit({ type: 'answered', requestId })
      return true
    },
    interrupt() {
      if (!busy || !proc.alive) return false
      if (queue.length > 0) {
        // Still starting: the task is dropped, never sent.
        queue.length = 0
        endTurn()
        emit({
          type: 'turn_end',
          ok: false,
          interrupted: true,
          text: '',
          costUsd: null,
          denials: 0
        })
        return true
      }
      if (!interruptedTurn) interruptWanted = true
      sendInterrupt()
      return true
    },
    stop() {
      stopping = true
      return proc.stop()
    }
  }
}
