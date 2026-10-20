// tests/unit/main/lib/agents/codex/run.test.ts
import { readFileSync } from 'fs'

import { beforeAll, describe, expect, it } from 'vitest'

import { THREAD, blocked, next, prepareFake, start } from './fake'

beforeAll(prepareFake)

describe('Codex run', () => {
  it('handshakes, starts a thread in workspace-write with the mode’s approval policy, never full access', async () => {
    for (const [mode, policy] of [
      ['default', 'untrusted'],
      ['acceptEdits', 'on-request'],
      ['auto', 'never']
    ] as const) {
      const { run, recorded } = start(
        'allow-decline-interrupt.jsonl',
        {},
        { permissionMode: mode, model: 'gpt-x' }
      )
      run.send('hi')
      await next(run, (e) => e.type === 'init')
      const sent = recorded()
      expect(sent[0]).toMatchObject({
        method: 'initialize',
        params: { clientInfo: { name: 'actovia' } }
      })
      expect(sent[1]).toEqual({ method: 'initialized' })
      expect(sent[2]).toMatchObject({
        method: 'thread/start',
        params: {
          approvalPolicy: policy,
          approvalsReviewer: 'user',
          sandbox: 'workspace-write',
          config: { 'sandbox_workspace_write.network_access': false },
          model: 'gpt-x'
        }
      })
      expect(JSON.stringify(sent)).not.toMatch(/danger-full-access/u)
      await run.stop()
    }
  })

  it('interrupts the running turn by its id and lives on', async () => {
    const { run, recorded } = start('allow-decline-interrupt.jsonl')
    for (let i = 0; i < 2; i++) {
      run.send(String(i))
      run.respond((await blocked(run)).prompt.requestId, {
        kind: i === 0 ? 'allow' : 'deny'
      })
      await next(run, (e) => e.type === 'turn_end')
    }
    run.send('sleep')
    run.respond((await blocked(run)).prompt.requestId, { kind: 'allow' })
    expect(run.interrupt()).toBe(true)
    const end = await next(run, (e) => e.type === 'turn_end')
    expect(end).toMatchObject({ interrupted: true, ok: false })
    expect(
      recorded().find((m) => m.method === 'turn/interrupt')?.params
    ).toMatchObject({ threadId: THREAD })
    expect(run.alive).toBe(true)
    await run.stop()
  })

  it('sends a Stop pressed before the turn had an id once the id is known', async () => {
    const { run, recorded } = start('allow-decline-interrupt.jsonl')
    run.send('1')
    run.respond((await blocked(run)).prompt.requestId, { kind: 'allow' })
    await next(run, (e) => e.type === 'turn_end')
    // turn/start is on its way: the turn has no id yet.
    run.send('2')
    expect(run.interrupt()).toBe(true)
    const end = await next(run, (e) => e.type === 'turn_end')
    expect(end).toMatchObject({ interrupted: true })
    expect(
      recorded().filter((m) => m.method === 'turn/interrupt')
    ).toHaveLength(1)
    await run.stop()
  })

  it('a Stop while the task waits for the handshake drops it: stopped, and no turn/start', async () => {
    const { run, recorded, events } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_INIT_DELAY_MS: '200'
    })
    run.send('1')
    expect(run.interrupt()).toBe(true)
    expect(events.at(-1)).toMatchObject({
      type: 'turn_end',
      ok: false,
      interrupted: true
    })
    expect(run.busy).toBe(false)
    await new Promise((r) => {
      setTimeout(r, 400)
    })
    const methods = recorded().map((m) => m.method)
    expect(methods).toContain('thread/start')
    expect(methods).not.toContain('turn/start')
    expect(methods).not.toContain('turn/interrupt')
    expect(run.alive).toBe(true)
    await run.stop()
  })

  it('never runs when Codex reports other approval settings than asked (a managed config)', async () => {
    for (const override of [
      { approvalPolicy: 'never' },
      { approvalsReviewer: 'auto_review' },
      { sandbox: { type: 'dangerFullAccess' } },
      {
        sandbox: {
          type: 'workspaceWrite',
          writableRoots: [],
          networkAccess: true
        }
      }
    ]) {
      const { run, recorded, events } = start('allow-decline-interrupt.jsonl', {
        FAKE_CODEX_THREAD_OVERRIDE: JSON.stringify(override)
      })
      run.send('x')
      const exit = await next(run, (e) => e.type === 'exit')
      expect(exit).toMatchObject({ expected: false })
      expect((exit as { stderrTail: string }).stderrTail).toMatch(
        /Codex overrode/u
      )
      const notice = events.find((e) => e.type === 'notice')
      expect(notice).toMatchObject({
        text: expect.stringMatching(/managed or enterprise/u)
      })
      expect(recorded().map((m) => m.method)).not.toContain('turn/start')
    }
  })

  it('a turn/completed from another thread does not end this turn', async () => {
    const { run, events } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_EXTRA_NOTIFY: JSON.stringify({
        method: 'turn/completed',
        params: {
          threadId: 'another-thread',
          turn: { id: 'x', status: 'completed', error: null }
        }
      })
    })
    run.send('1')
    const b = await blocked(run)
    expect(events.some((e) => e.type === 'turn_end')).toBe(false)
    expect(run.busy).toBe(true)
    expect(run.respond(b.prompt.requestId, { kind: 'allow' })).toBe(true)
    await next(run, (e) => e.type === 'turn_end')
    expect(events.filter((e) => e.type === 'turn_end')).toHaveLength(1)
    await run.stop()
  })

  it('an answer to one process’s request 0 never answers another’s', async () => {
    const one = start('allow-decline-interrupt.jsonl')
    const two = start('allow-decline-interrupt.jsonl')
    one.run.send('1')
    two.run.send('1')
    const [a, b] = await Promise.all([blocked(one.run), blocked(two.run)])
    expect(a.prompt.requestId).not.toBe(b.prompt.requestId)
    expect(two.run.respond(a.prompt.requestId, { kind: 'allow' })).toBe(false)
    expect(two.run.respond(b.prompt.requestId, { kind: 'allow' })).toBe(true)
    expect(one.run.respond(a.prompt.requestId, { kind: 'allow' })).toBe(true)
    await Promise.all([
      next(one.run, (e) => e.type === 'turn_end'),
      next(two.run, (e) => e.type === 'turn_end')
    ])
    await Promise.all([one.run.stop(), two.run.stop()])
  })

  it('queues a task sent before the handshake finished', async () => {
    const { run, recorded } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_INIT_DELAY_MS: '300'
    })
    expect(run.send('early')).toBe(true)
    await next(run, (e) => e.type === 'init')
    const methods = recorded().map((m) => m.method)
    expect(methods.indexOf('turn/start')).toBeGreaterThan(
      methods.indexOf('thread/start')
    )
    await run.stop()
  })

  it('resumes a thread by id in a new process', async () => {
    const { run, recorded } = start(
      'resume.jsonl',
      {},
      { resume: '01a1245d-2907-72f3-9b06-3dc67f153940' }
    )
    run.send('what did I refuse?')
    await next(run, (e) => e.type === 'turn_end')
    expect(
      recorded().find((m) => m.method === 'thread/resume')?.params
    ).toMatchObject({
      threadId: '01a1245d-2907-72f3-9b06-3dc67f153940',
      sandbox: 'workspace-write'
    })
    await run.stop()
  })

  it('fails with Codex’s message when the thread can’t start', async () => {
    const { run } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_THREAD_ERROR: 'Not logged in'
    })
    run.send('x')
    const exit = await next(run, (e) => e.type === 'exit')
    expect(exit).toMatchObject({ expected: false })
    expect((exit as { stderrTail: string }).stderrTail).toMatch(
      /Not logged in/u
    )
  })

  it('sends one turn/interrupt per turn however often Stop is pressed, and none when idle', async () => {
    const { run, recorded } = start('allow-decline-interrupt.jsonl')
    expect(run.interrupt()).toBe(false)
    run.send('1')
    await blocked(run)
    expect(run.interrupt()).toBe(true)
    expect(run.interrupt()).toBe(true)
    await next(run, (e) => e.type === 'turn_end')
    expect(run.interrupt()).toBe(false)
    expect(
      recorded().filter((m) => m.method === 'turn/interrupt')
    ).toHaveLength(1)
    await run.stop()
  })

  it('logs the server’s lines', async () => {
    const { run, logPath } = start('allow-decline-interrupt.jsonl')
    run.send('1')
    run.respond((await blocked(run)).prompt.requestId, { kind: 'allow' })
    await next(run, (e) => e.type === 'turn_end')
    await run.stop()
    expect(readFileSync(logPath, 'utf8')).toMatch(/turn\/completed/u)
  })

  it('a Stop while Codex is starting is a stop, not a failure', async () => {
    const { run } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_INIT_DELAY_MS: '200'
    })
    run.send('1')
    const exit = next(run, (e) => e.type === 'exit')
    await run.stop()
    expect(await exit).toMatchObject({ type: 'exit', expected: true })
    expect(((await exit) as { stderrTail: string }).stderrTail).not.toMatch(
      /not running/u
    )
  })

  it('takes one task at a time: a send while a turn runs is refused', async () => {
    const { run, recorded } = start('allow-decline-interrupt.jsonl')
    expect(run.send('1')).toBe(true)
    expect(run.send('2')).toBe(false)
    run.respond((await blocked(run)).prompt.requestId, { kind: 'allow' })
    await next(run, (e) => e.type === 'turn_end')
    expect(recorded().filter((m) => m.method === 'turn/start')).toHaveLength(1)
    expect(run.send('3')).toBe(true)
    await run.stop()
  })
})
