// tests/unit/main/lib/agents/codex/run.test.ts
import { readFileSync } from 'fs'

import { beforeAll, describe, expect, it } from 'vitest'

import { blocked, next, prepareFake, start } from './fake'

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
        params: { clientInfo: { name: 'exodus' } }
      })
      expect(sent[1]).toEqual({ method: 'initialized' })
      expect(sent[2]).toMatchObject({
        method: 'thread/start',
        params: {
          approvalPolicy: policy,
          sandbox: 'workspace-write',
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
    ).toMatchObject({ threadId: '01a1245d-2907-72f3-9b06-3dc67f153940' })
    expect(run.alive).toBe(true)
    await run.stop()
  })

  it('sends a Stop pressed before the turn had an id once the id is known', async () => {
    const { run, recorded } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_INIT_DELAY_MS: '200'
    })
    run.send('1')
    expect(run.interrupt()).toBe(true)
    const end = await next(run, (e) => e.type === 'turn_end')
    expect(end).toMatchObject({ interrupted: true })
    expect(
      recorded().filter((m) => m.method === 'turn/interrupt')
    ).toHaveLength(1)
    await run.stop()
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
