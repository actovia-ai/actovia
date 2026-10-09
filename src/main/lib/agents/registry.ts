// src/main/lib/agents/registry.ts
import type { AgentRun } from './driver'
import { agentSettings } from './settings'

interface Entry {
  run: AgentRun
  sessionId: string
  projectId: string
  idleTimer?: ReturnType<typeof setTimeout>
  /** Set by `cancelIdleExit`; a timer armed after the cancel (the settings read is async) checks it. */
  idleCancelled?: boolean
}

/** Live agent runs (spec §8): the running limit, one step at a time per employee and project, the keep-alive, quit. */
export class AgentRegistry {
  private entries = new Map<string, Entry>()
  private queues = new Map<string, Promise<unknown>>()
  private inFlight = 0
  private waiters: Array<() => void> = []

  constructor(
    private deps: {
      maxRunning(): Promise<number>
      keepAliveMs(): Promise<number>
    }
  ) {}

  async acquireSlot(signal?: AbortSignal): Promise<() => void> {
    for (;;) {
      if (signal?.aborted) throw signal.reason
      if (this.inFlight < (await this.deps.maxRunning())) break
      await new Promise<void>((resolve, reject) => {
        // The limit is read asynchronously, so the abort may already have fired.
        if (signal?.aborted) {
          reject(signal.reason)
          return
        }
        const wake = () => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }
        const onAbort = () => {
          this.waiters = this.waiters.filter((w) => w !== wake)
          reject(signal!.reason)
        }
        this.waiters.push(wake)
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    }
    this.inFlight++
    let released = false
    return () => {
      if (released) return
      released = true
      this.inFlight--
      this.waiters.shift()?.()
    }
  }

  queue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(fn)
    const tail = next.catch(() => undefined)
    this.queues.set(key, tail)
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key)
    })
    return next
  }

  attach(
    key: string,
    sessionId: string,
    projectId: string,
    run: AgentRun
  ): void {
    this.entries.set(key, { run, sessionId, projectId })
    const off = run.on((e) => {
      if (e.type !== 'exit') return
      off()
      const entry = this.entries.get(key)
      if (entry?.run === run) {
        clearTimeout(entry.idleTimer)
        this.entries.delete(key)
      }
    })
  }

  live(key: string): AgentRun | undefined {
    const run = this.entries.get(key)?.run
    return run?.alive ? run : undefined
  }

  bySession(sessionId: string): AgentRun | undefined {
    for (const e of this.entries.values())
      if (e.sessionId === sessionId && e.run.alive) return e.run
    return undefined
  }

  runningInProject(projectId: string): number {
    let n = 0
    for (const e of this.entries.values())
      if (e.projectId === projectId && e.run.alive && e.run.busy) n++
    return n
  }

  scheduleIdleExit(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    clearTimeout(entry.idleTimer)
    entry.idleCancelled = false
    void this.deps.keepAliveMs().then((ms) => {
      if (this.entries.get(key) !== entry || entry.idleCancelled) return
      entry.idleTimer = setTimeout(() => {
        if (!entry.idleCancelled && !entry.run.busy) void entry.run.stop()
      }, ms)
    })
  }

  cancelIdleExit(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.idleCancelled = true
    clearTimeout(entry.idleTimer)
    entry.idleTimer = undefined
  }

  async stopSession(sessionId: string): Promise<void> {
    for (const e of this.entries.values())
      if (e.sessionId === sessionId) await e.run.stop()
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].map(async (e) => {
        e.run.interrupt()
        await e.run.stop()
      })
    )
  }
}

export const agentRegistry = new AgentRegistry({
  maxRunning: async () => (await agentSettings()).maxRunning,
  keepAliveMs: async () => (await agentSettings()).keepAliveMinutes * 60_000
})
