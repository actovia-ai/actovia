// src/main/lib/agents/claude-code/run.ts
import type { AgentAnswer } from '@actovia/shared/types/agents'

import {
  isCliModel,
  type AgentEvent,
  type AgentRun,
  type StartInput
} from '../driver'
import { superviseProcess } from '../process'
import { parseLine } from './protocol'

export function buildArgs(input: StartInput): string[] {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-prompt-tool',
    'stdio',
    '--permission-mode',
    input.permissionMode
  ]
  if (input.model && isCliModel(input.model)) args.push('--model', input.model)
  if (input.resume) args.push('--resume', input.resume)
  return args
}

/** One `claude -p` process in stream-json (spec §2, §8). Never throws: failures arrive as `exit`. */
export function startClaudeCode(input: StartInput): AgentRun {
  const listeners = new Set<(e: AgentEvent) => void>()
  const pending = new Map<string, Record<string, unknown>>()
  let cliSessionId: string | null = null
  let busy = false
  let backgroundTasks = 0
  let interruptRequested = false
  let interrupts = 0

  const emit = (e: AgentEvent) => {
    for (const l of Array.from(listeners)) l(e)
  }

  const proc = superviseProcess({
    binPath: input.binPath,
    args: buildArgs(input),
    cwd: input.cwd,
    env: input.env,
    logPath: input.logPath,
    onLine(line) {
      const { events, control } = parseLine(line)
      if (control) pending.set(control.requestId, control.input)
      for (const e of events) {
        if (e.type === 'background_tasks') backgroundTasks = e.taskIds.length
        if (['text', 'text_delta', 'step_start', 'blocked'].includes(e.type))
          busy = true
        if (e.type === 'init') {
          cliSessionId = e.cliSessionId
          busy = true
        }
        if (e.type === 'turn_end') {
          busy = false
          pending.clear()
          if (interruptRequested) {
            interruptRequested = false
            emit({ ...e, interrupted: true })
            continue
          }
        }
        emit(e)
      }
    },
    onExit(info) {
      backgroundTasks = 0
      pending.clear()
      busy = false
      emit({ type: 'exit', ...info })
    }
  })

  return {
    get cliSessionId() {
      return cliSessionId
    },
    get alive() {
      return proc.alive
    },
    get busy() {
      // A gone child is not busy, though its last lines may still drain.
      return busy && proc.alive
    },
    get backgroundTasks() {
      return backgroundTasks
    },
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    send(text) {
      const ok = proc.write({
        type: 'user',
        message: { role: 'user', content: text }
      })
      if (ok) busy = true
      return ok
    },
    respond(requestId, answer: AgentAnswer) {
      const original = pending.get(requestId)
      if (!original || !proc.alive) return false
      const response =
        answer.kind === 'deny'
          ? {
              behavior: 'deny',
              message: answer.reason?.trim() || 'The owner declined.'
            }
          : answer.kind === 'answers'
            ? {
                behavior: 'allow',
                updatedInput: {
                  ...original,
                  // One string per question, picks joined as Claude Code asks.
                  answers: Object.fromEntries(
                    Object.entries(answer.answers).map(([k, v]) => [
                      k,
                      Array.isArray(v) ? v.join(', ') : v
                    ])
                  )
                }
              }
            : { behavior: 'allow', updatedInput: original }
      if (
        !proc.write({
          type: 'control_response',
          response: { subtype: 'success', request_id: requestId, response }
        })
      )
        return false
      pending.delete(requestId)
      emit({ type: 'answered', requestId })
      return true
    },
    interrupt() {
      if (!busy) return false
      interruptRequested = true
      return proc.write({
        type: 'control_request',
        request_id: `interrupt-${++interrupts}`,
        request: { subtype: 'interrupt' }
      })
    },
    stop() {
      return proc.stop()
    }
  }
}
