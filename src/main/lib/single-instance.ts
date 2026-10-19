import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { app } from 'electron'

/**
 * One Actovia process per data directory.
 *
 * PGlite has no cross-process lock: a second process on the same
 * `~/.exodus/database` corrupts it. The second instance did fail — but only at
 * binding port 60223, by which point it had opened the database, run the
 * migrations and written the startup clean-ups. So the lock is taken by
 * `db/db.ts`, before it constructs PGlite: no lock, no database.
 *
 * It is Electron's own lock (kernel-backed, keyed on `userData`, released when
 * the holder dies however it dies). Dev and packaged builds share `userData`,
 * so it holds between them too. It does not cover universal-client, which has a
 * `userData` of its own.
 *
 * A second launch has two very different causes, told apart by whether the
 * holder answers:
 * - the app is already running → the holder acknowledges and raises its
 *   window; this process exits at once.
 * - the app is on its way out (quit, then reopened straight away — closing
 *   PGlite cleanly takes up to 5s) → a quitting holder stays silent; this
 *   process waits for the lock and then starts normally, instead of the launch
 *   silently doing nothing.
 */

const RETRY_MS = 250
/** Longer than main.ts's PGLITE_CLOSE_TIMEOUT_MS, the slowest a quit can be. */
const WAIT_FOR_QUITTING_HOLDER_MS = 8000
const ACK_FILE = 'instance-ack'

export type LockOutcome = 'acquired' | 'already-running' | 'timed-out'

export interface LockDeps {
  /** One attempt at the lock. A failed attempt signals the holder. */
  request(): boolean
  sleep(ms: number): void
  now(): number
  /** When the holder last acknowledged a launch (epoch ms), if ever. */
  lastAck(): number | null
}

export function acquireLock(deps: LockDeps): LockOutcome {
  const started = deps.now()
  for (;;) {
    if (deps.request()) return 'acquired'
    deps.sleep(RETRY_MS)
    const ack = deps.lastAck()
    if (ack !== null && ack >= started) return 'already-running'
    if (deps.now() - started >= WAIT_FOR_QUITTING_HOLDER_MS) return 'timed-out'
  }
}

let outcome: LockOutcome | undefined
let quitting = false
let raiseWindow: (() => void) | undefined

const ackPath = () => join(app.getPath('userData'), ACK_FILE)

function readAck(): number | null {
  try {
    const at = Number(readFileSync(ackPath(), 'utf8'))
    return Number.isFinite(at) ? at : null
  } catch {
    return null
  }
}

/**
 * Takes the lock, or ends this process. Synchronous on purpose — it runs while
 * `db.ts` is being imported. Here `app.exit()` was observed to stop everything
 * after it (no later statement, microtask or immediate ran), but Electron
 * documents it only as quitting "immediately", not as a synchronous exit:
 * `remote-debugging-guard.ts`, which must stop before the next module is even
 * evaluated, does not rely on it and calls Node's own `reallyExit` instead.
 */
export function holdSingleInstanceLock(): void {
  if (outcome !== undefined) return
  // Unit tests load db.ts under a stub `electron`, or none at all.
  if (typeof app?.requestSingleInstanceLock !== 'function') {
    outcome = 'acquired'
    return
  }

  const sleeper = new Int32Array(new SharedArrayBuffer(4))
  outcome = acquireLock({
    request: () => app.requestSingleInstanceLock(),
    sleep: (ms) => void Atomics.wait(sleeper, 0, 0, ms),
    now: Date.now,
    lastAck: readAck
  })

  if (outcome !== 'acquired') {
    // `timed-out`: a holder that neither answers nor goes away (hung, or so
    // old it predates this). Its database is still not ours to open.
    app.exit(0)
    return
  }

  app.on('before-quit', () => {
    quitting = true
  })
  // Registered here rather than once a window exists, so a launch during
  // start-up is answered too.
  app.on('second-instance', () => {
    if (quitting) return
    try {
      // In the file, not its mtime: some filesystems round that to seconds.
      writeFileSync(ackPath(), String(Date.now()))
    } catch {
      // Unanswered, the other process waits out its timeout and exits anyway.
    }
    raiseWindow?.()
  })
}

/** What "the app is already running" should do, once there is a window. */
export function onSecondInstance(handler: () => void): void {
  raiseWindow = handler
}
