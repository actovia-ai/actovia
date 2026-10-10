// src/main/lib/agents/process.ts
import { spawn } from 'child_process'
import {
  closeSync,
  constants,
  createWriteStream,
  fstatSync,
  openSync
} from 'fs'
import { createInterface } from 'readline'

const STDERR_KEEP = 4096

export interface ExitInfo {
  code: number | null
  stderrTail: string
  expected: boolean
}

export interface Supervised {
  readonly alive: boolean
  /** One JSON value, one line; false when the child is gone or stdin is closed. */
  write(value: unknown): boolean
  /** End stdin, SIGTERM after 1.5 s, SIGKILL after 3 s; resolves once `onExit` has run. */
  stop(): Promise<void>
  /** Kill the child and report `message` as the exit's stderr tail, unexpected (a failed handshake). */
  fail(message: string): Promise<void>
}

/**
 * One CLI child speaking newline-delimited JSON on stdio (spec §2, §8), with
 * its stdout appended to `logPath`. Never throws: failures arrive as `onExit`.
 */
export function superviseProcess(opts: {
  binPath: string
  args: string[]
  cwd: string
  env: Record<string, string>
  logPath: string
  onLine(line: string): void
  /** Called exactly once, after stdout drained (≤1.5 s after the child exits); no `onLine` after it. */
  onExit(info: ExitInfo): void
}): Supervised {
  // Never follow a symlink at the log path, nor append through a hard link
  // (an agent can plant either in its own cwd to make Exodus write elsewhere);
  // logging is optional, so a refusal disables it, not the run.
  let log: ReturnType<typeof createWriteStream> | null = null
  let fd: number | null = null
  try {
    fd = openSync(
      opts.logPath,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_NOFOLLOW,
      0o600
    )
    const info = fstatSync(fd)
    if (!info.isFile() || info.nlink !== 1)
      throw new Error('Refusing a log that is not one plain file')
    log = createWriteStream(opts.logPath, { fd, autoClose: true })
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
  let alive = true
  let stopping = false
  let failMessage: string | undefined
  let stderr = ''

  const child = spawn(opts.binPath, opts.args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  // A dead child surfaces as `onExit`; a write to it must not throw.
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
    // Only stdout is logged: what Exodus writes (the owner's answers) never is.
    log?.write(line + '\n')
    opts.onLine(line)
  })

  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-STDERR_KEEP)
  })

  let exitCode: number | null = null
  let exitMessage: string | undefined
  let settle: () => void = () => {}
  const settled = new Promise<void>((r) => (settle = r))
  // `onExit` is the last call: it waits for stdout to drain (so no line is
  // lost and none follows it), but not for a grandchild holding the pipe open.
  const finish = () => {
    if (finished) return
    finished = true
    log?.end()
    opts.onExit({
      code: exitCode,
      stderrTail: (failMessage ?? exitMessage ?? stderr).trim(),
      expected: stopping && failMessage === undefined
    })
    settle()
  }
  const onChildGone = (code: number | null, message?: string) => {
    if (childExited) return
    childExited = true
    alive = false
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

  const kill = (signal: NodeJS.Signals) => !childExited && child.kill(signal)

  return {
    get alive() {
      return alive
    },
    write(value) {
      if (!alive || !child.stdin.writable) return false
      child.stdin.write(JSON.stringify(value) + '\n')
      return true
    },
    stop() {
      if (childExited) return settled
      stopping = true
      child.stdin.end()
      const term = setTimeout(() => kill('SIGTERM'), 1500)
      const hard = setTimeout(() => kill('SIGKILL'), 3000)
      void settled.then(() => {
        clearTimeout(term)
        clearTimeout(hard)
      })
      return settled
    },
    fail(message) {
      if (childExited) return settled
      failMessage = message
      child.stdin.end()
      kill('SIGTERM')
      const hard = setTimeout(() => kill('SIGKILL'), 1500)
      void settled.then(() => clearTimeout(hard))
      return settled
    }
  }
}
