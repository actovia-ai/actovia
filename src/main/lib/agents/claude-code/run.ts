// src/main/lib/agents/claude-code/run.ts
import { spawn } from 'child_process'
import {
  closeSync,
  constants,
  createWriteStream,
  fstatSync,
  openSync
} from 'fs'
import { createInterface } from 'readline'

import type { AgentAnswer } from '@exodus/shared/types/agents'

import type { AgentEvent, AgentRun, StartInput } from '../driver'
import { parseLine } from './protocol'

const STDERR_KEEP = 4096

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
  if (input.model) args.push('--model', input.model)
  if (input.resume) args.push('--resume', input.resume)
  return args
}

/** One `claude -p` process in stream-json (spec §2, §8). Never throws: failures arrive as `exit`. */
export function startClaudeCode(input: StartInput): AgentRun {
  const listeners = new Set<(e: AgentEvent) => void>()
  const pending = new Map<string, Record<string, unknown>>()
  // Never follow a symlink at the log path, nor append through a hard link
  // (an agent can plant either in its own cwd to make Exodus write elsewhere);
  // logging is optional, so a refusal disables it, not the run.
  let log: ReturnType<typeof createWriteStream> | null = null
  let fd: number | null = null
  try {
    fd = openSync(
      input.logPath,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_NOFOLLOW,
      0o600
    )
    const info = fstatSync(fd)
    if (!info.isFile() || info.nlink !== 1)
      throw new Error('Refusing a log that is not one plain file')
    log = createWriteStream(input.logPath, { fd, autoClose: true })
    // Logging must never break the run.
    log.on('error', () => {})
  } catch {
    if (fd !== null && !log)
      try {
        closeSync(fd)
      } catch {
        // already closed
      }
    log = null
  }
  let cliSessionId: string | null = null
  let alive = true
  let busy = false
  let stopping = false
  let interruptRequested = false
  let interrupts = 0
  let stderr = ''

  const emit = (e: AgentEvent) => {
    for (const l of Array.from(listeners)) l(e)
  }

  const child = spawn(input.binPath, buildArgs(input), {
    cwd: input.cwd,
    env: input.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  const write = (o: unknown): boolean => {
    if (!alive || !child.stdin.writable) return false
    child.stdin.write(JSON.stringify(o) + '\n')
    return true
  }

  // A dead child surfaces as `exit`; a write to it must not throw.
  child.stdin.on('error', () => {})
  child.stdout.on('error', () => {})
  child.stderr.on('error', () => {})

  const lines = createInterface({ input: child.stdout })
  let childExited = false
  let finished = false
  let stdoutClosed = false
  let finishNow = () => {}
  lines.on('close', () => {
    stdoutClosed = true
    finishNow()
  })
  lines.on('line', (line) => {
    if (finished) return
    log?.write(line + '\n')
    const { events, control } = parseLine(line)
    if (control) pending.set(control.requestId, control.input)
    for (const e of events) {
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
  })

  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-STDERR_KEEP)
  })

  let exitCode: number | null = null
  let exitMessage: string | undefined
  let settle: () => void = () => {}
  const settled = new Promise<void>((r) => (settle = r))
  // `exit` is the last event: it waits for stdout to drain (so no line is lost
  // and no event follows it), but not for a grandchild holding the pipe open.
  const finish = () => {
    if (finished) return
    finished = true
    pending.clear()
    log?.end()
    emit({
      type: 'exit',
      code: exitCode,
      stderrTail: (exitMessage ?? stderr).trim(),
      expected: stopping
    })
    settle()
  }
  const onChildGone = (code: number | null, message?: string) => {
    if (childExited) return
    childExited = true
    alive = false
    busy = false
    exitCode = code
    exitMessage = message
    if (message !== undefined) return finish()
    if (stdoutClosed) return finish()
    const timer = setTimeout(finish, 1500)
    finishNow = () => {
      clearTimeout(timer)
      finish()
    }
  }
  child.on('error', (err) => onChildGone(null, err.message))
  child.on('exit', (code) => onChildGone(code))

  return {
    get cliSessionId() {
      return cliSessionId
    },
    get alive() {
      return alive
    },
    get busy() {
      return busy
    },
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    send(text) {
      const ok = write({
        type: 'user',
        message: { role: 'user', content: text }
      })
      if (ok) busy = true
      return ok
    },
    respond(requestId, answer: AgentAnswer) {
      const original = pending.get(requestId)
      if (!original || !alive) return false
      const response =
        answer.kind === 'deny'
          ? {
              behavior: 'deny',
              message: answer.reason?.trim() || 'The owner declined.'
            }
          : answer.kind === 'answers'
            ? {
                behavior: 'allow',
                updatedInput: { ...original, answers: answer.answers }
              }
            : { behavior: 'allow', updatedInput: original }
      if (
        !write({
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
      return write({
        type: 'control_request',
        request_id: `interrupt-${++interrupts}`,
        request: { subtype: 'interrupt' }
      })
    },
    stop() {
      if (childExited) return settled
      stopping = true
      child.stdin.end()
      const term = setTimeout(() => !childExited && child.kill('SIGTERM'), 1500)
      const kill = setTimeout(() => !childExited && child.kill('SIGKILL'), 3000)
      void settled.then(() => {
        clearTimeout(term)
        clearTimeout(kill)
      })
      return settled
    }
  }
}
