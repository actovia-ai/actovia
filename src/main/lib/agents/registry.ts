// src/main/lib/agents/registry.ts
import type { CliId } from '@exodus/shared/types/agents'

import type { AgentRun } from './driver'
import { agentSettings } from './settings'

interface Entry {
  run: AgentRun
  sessionId: string
  cli: CliId
  projectId: string
  /** The group whose step the process runs now (a session follows its latest step). */
  conversationId: string
  idleTimer?: ReturnType<typeof setTimeout>
  /** Set by `cancelIdleExit`; a timer armed after the cancel (the settings read is async) checks it. */
  idleCancelled?: boolean
}

/** Live agent runs (spec §8): the running limit, one step at a time per employee and project, the keep-alive, quit. */
export class AgentRegistry {
  private entries = new Map<string, Entry>()
  private queues = new Map<string, Promise<unknown>>()
  private inFlight = 0
  /** Steps under way per project, from before their first await (see `claimProject`). */
  private claims = new Map<string, number>()
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
      const max = await this.deps.maxRunning()
      // The limit is read asynchronously: an abort during the read must not take a slot.
      if (signal?.aborted) throw signal.reason
      if (this.inFlight < max) break
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
      // Wake everyone: each re-reads the limit and parks again if there is no room, so a
      // waiter that aborted meanwhile cannot swallow the wake, and a raised limit admits more.
      const woken = this.waiters
      this.waiters = []
      for (const wake of woken) wake()
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

  /**
   * A step in `projectId` is under way. Taken synchronously as the step
   * begins, so parallel steps see each other before any process attaches
   * (a step's worktree depends on it); the returned function gives it back.
   */
  claimProject(projectId: string): () => void {
    this.claims.set(projectId, (this.claims.get(projectId) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const n = (this.claims.get(projectId) ?? 1) - 1
      if (n > 0) this.claims.set(projectId, n)
      else this.claims.delete(projectId)
    }
  }

  claimsInProject(projectId: string): number {
    return this.claims.get(projectId) ?? 0
  }

  attach(
    key: string,
    sessionId: string,
    cli: CliId,
    projectId: string,
    conversationId: string,
    run: AgentRun
  ): void {
    this.entries.set(key, { run, sessionId, cli, projectId, conversationId })
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

  /** A live process takes a step from another group: it belongs to that group now. */
  bindConversation(key: string, conversationId: string): void {
    const entry = this.entries.get(key)
    if (entry) entry.conversationId = conversationId
  }

  live(key: string): AgentRun | undefined {
    const run = this.entries.get(key)?.run
    return run?.alive ? run : undefined
  }

  /**
   * The live process under `key` if it runs `sessionId` with `cli`; one that
   * runs another session or CLI (the employee was switched, its thread
   * dropped) is stopped first and never reused.
   */
  async liveFor(
    key: string,
    sessionId: string,
    cli: CliId
  ): Promise<AgentRun | undefined> {
    const entry = this.entries.get(key)
    if (!entry?.run.alive) return undefined
    if (entry.sessionId === sessionId && entry.cli === cli) return entry.run
    await entry.run.stop()
    return undefined
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

  /** The group is going away (spec §10): interrupt and exit every agent working for it. */
  async stopConversation(conversationId: string): Promise<void> {
    await Promise.all(
      [...this.entries.values()]
        .filter((e) => e.conversationId === conversationId)
        .map(async (e) => {
          e.run.interrupt()
          await e.run.stop()
        })
    )
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
