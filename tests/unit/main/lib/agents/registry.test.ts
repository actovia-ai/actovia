import type { AgentEvent, AgentRun } from '@main/lib/agents/driver'
// tests/unit/main/lib/agents/registry.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/agents/settings', () => ({
  agentSettings: async () => ({ maxRunning: 2, keepAliveMinutes: 10 })
}))
const { AgentRegistry } = await import('@main/lib/agents/registry')

function fakeRun(): AgentRun & {
  fire(e: AgentEvent): void
  stops: number
  interrupts: number
  busyFlag: boolean
} {
  const listeners = new Set<(e: AgentEvent) => void>()
  const run = {
    cliSessionId: 'x',
    alive: true,
    busyFlag: false,
    get busy() {
      return run.busyFlag
    },
    stops: 0,
    interrupts: 0,
    on(l: (e: AgentEvent) => void) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    send: () => true,
    respond: () => true,
    interrupt() {
      run.interrupts++
      return true
    },
    async stop() {
      run.stops++
      run.alive = false
      run.fire({ type: 'exit', code: 0, stderrTail: '', expected: true })
    },
    fire(e: AgentEvent) {
      for (const l of listeners) l(e)
    }
  }
  return run as never
}

const registry = (max = 2, keepMs = 1000) =>
  new AgentRegistry({
    maxRunning: async () => max,
    keepAliveMs: async () => keepMs
  })

afterEach(() => vi.useRealTimers())

describe('agent registry', () => {
  it('lets no more than the limit through, and the next in when one releases', async () => {
    const r = registry(2)
    const a = await r.acquireSlot()
    await r.acquireSlot()
    let third = false
    const pending = r.acquireSlot().then((release) => {
      third = true
      return release
    })
    await Promise.resolve()
    expect(third).toBe(false)
    a()
    a() // releasing twice frees one slot, not two
    await pending
    expect(third).toBe(true)
  })

  it('gives up waiting when aborted', async () => {
    const r = registry(1)
    await r.acquireSlot()
    const ctrl = new AbortController()
    const waiting = r.acquireSlot(ctrl.signal)
    ctrl.abort(new Error('stopped'))
    await expect(waiting).rejects.toThrow('stopped')
  })

  it('passes the wake on when the woken waiter was aborted', async () => {
    const r = registry(1)
    const releaseA = await r.acquireSlot()
    const ctrlB = new AbortController()
    const b = r.acquireSlot(ctrlB.signal)
    const c = r.acquireSlot()
    await new Promise((ok) => setTimeout(ok, 0))
    releaseA()
    ctrlB.abort(new Error('stopped'))
    await expect(b).rejects.toThrow('stopped')
    const releaseC = await c
    expect(typeof releaseC).toBe('function')
  })

  it('does not take a slot when aborted while the limit is being read', async () => {
    let resolveMax!: (n: number) => void
    let first = true
    const r = new AgentRegistry({
      maxRunning: () =>
        first
          ? ((first = false), new Promise<number>((ok) => (resolveMax = ok)))
          : Promise.resolve(1),
      keepAliveMs: async () => 1000
    })
    const ctrl = new AbortController()
    const pending = r.acquireSlot(ctrl.signal)
    ctrl.abort(new Error('stopped'))
    resolveMax(1)
    await expect(pending).rejects.toThrow('stopped')
    const release = await r.acquireSlot()
    expect(typeof release).toBe('function')
  })

  it('admits a waiter on the next release when the limit was raised', async () => {
    let max = 1
    const r = new AgentRegistry({
      maxRunning: async () => max,
      keepAliveMs: async () => 1000
    })
    const releaseA = await r.acquireSlot()
    let admitted = false
    const waiting = r.acquireSlot().then((rel) => {
      admitted = true
      return rel
    })
    await new Promise((ok) => setTimeout(ok, 0))
    expect(admitted).toBe(false)
    max = 2
    releaseA()
    await waiting
    expect(admitted).toBe(true)
  })

  it('runs one step at a time per employee and project, in order, past a failure', async () => {
    const r = registry()
    const order: string[] = []
    const slow =
      (name: string, ms: number, fail = false) =>
      () =>
        new Promise<void>((ok, no) =>
          setTimeout(() => {
            order.push(name)
            if (fail) no(new Error(name))
            else ok()
          }, ms)
        )
    const first = r.queue('p:a', slow('first', 30, true))
    const second = r.queue('p:a', slow('second', 1))
    const other = r.queue('p:b', slow('other', 1))
    await expect(first).rejects.toThrow('first')
    await Promise.all([second, other])
    expect(order).toEqual(['other', 'first', 'second'])
  })

  it('finds a live run by key and by session, and forgets it when it exits', async () => {
    const r = registry()
    const run = fakeRun()
    r.attach('p:a', 's1', 'p', run)
    expect(r.live('p:a')).toBe(run)
    expect(r.bySession('s1')).toBe(run)
    run.alive = false
    run.fire({ type: 'exit', code: 1, stderrTail: '', expected: false })
    expect(r.live('p:a')).toBeUndefined()
    expect(r.bySession('s1')).toBeUndefined()
  })

  it('counts the busy runs of a project', () => {
    const r = registry()
    const a = fakeRun()
    const b = fakeRun()
    r.attach('p:a', 's1', 'p', a)
    r.attach('p:b', 's2', 'p', b)
    a.busyFlag = true
    expect(r.runningInProject('p')).toBe(1)
    expect(r.runningInProject('other')).toBe(0)
  })

  it('stops an idle run after the keep-alive, not a busy one, and not one picked up again', async () => {
    vi.useFakeTimers()
    const r = registry(2, 1000)
    const idle = fakeRun()
    const busy = fakeRun()
    const reused = fakeRun()
    r.attach('k1', 's1', 'p', idle)
    r.attach('k2', 's2', 'p', busy)
    r.attach('k3', 's3', 'p', reused)
    busy.busyFlag = true
    r.scheduleIdleExit('k1')
    r.scheduleIdleExit('k2')
    r.scheduleIdleExit('k3')
    await vi.advanceTimersByTimeAsync(10)
    r.cancelIdleExit('k3')
    await vi.advanceTimersByTimeAsync(1000)
    expect(idle.stops).toBe(1)
    expect(busy.stops).toBe(0)
    expect(reused.stops).toBe(0)
  })

  it('stops everything at quit, interrupting first', async () => {
    const r = registry()
    const a = fakeRun()
    const b = fakeRun()
    r.attach('k1', 's1', 'p', a)
    r.attach('k2', 's2', 'p', b)
    await r.stopAll()
    expect([a.interrupts, a.stops, b.interrupts, b.stops]).toEqual([1, 1, 1, 1])
  })
})
