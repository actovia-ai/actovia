// tests/unit/main/lib/agents/codex/run.test.ts
import { chmodSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { startCodex } from '@main/lib/agents/codex/run'
import type { AgentEvent, AgentRun } from '@main/lib/agents/driver'
import { beforeAll, describe, expect, it } from 'vitest'

const FIX = resolve(import.meta.dirname, '../../../../../fixtures/codex')
const FAKE = join(FIX, 'fake-codex.mjs')
beforeAll(() => chmodSync(FAKE, 0o755))

function start(
  fixture: string,
  extra: Record<string, string> = {},
  input: Partial<Parameters<typeof startCodex>[0]> = {}
) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-run-'))
  const recordPath = join(dir, 'record.jsonl')
  const logPath = join(dir, 'raw.jsonl')
  const run = startCodex({
    binPath: FAKE,
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? '',
      FAKE_CODEX_FIXTURE: join(FIX, fixture),
      FAKE_CODEX_RECORD: recordPath,
      ...extra
    },
    permissionMode: 'default',
    logPath,
    ...input
  })
  const events: AgentEvent[] = []
  run.on((e) => events.push(e))
  const recorded = () =>
    readFileSync(recordPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((r) => r.stdin)
      .map((r) => r.stdin)
  return { run, events, recorded, logPath }
}

function next(
  run: AgentRun,
  match: (e: AgentEvent) => boolean,
  ms = 5000
): Promise<AgentEvent> {
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('timed out')), ms)
    const off = run.on((e) => {
      if (match(e)) {
        clearTimeout(timer)
        off()
        ok(e)
      }
    })
  })
}
const blocked = (run: AgentRun) =>
  next(run, (e) => e.type === 'blocked') as Promise<
    Extract<AgentEvent, { type: 'blocked' }>
  >

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

  it('accepts a change on Allow with the request’s own id', async () => {
    const { run, recorded } = start('allow-decline-interrupt.jsonl')
    run.send('create hello.txt')
    const b = await blocked(run)
    expect(run.respond(b.prompt.requestId, { kind: 'allow' })).toBe(true)
    expect(run.respond(b.prompt.requestId, { kind: 'allow' })).toBe(false)
    await next(run, (e) => e.type === 'turn_end')
    expect(recorded()).toContainEqual({
      id: Number(b.prompt.requestId),
      result: { decision: 'accept' }
    })
    expect(run.cliSessionId).toBe('01a1245d-2907-72f3-9b06-3dc67f153940')
    await run.stop()
  })

  it('declines on Deny', async () => {
    const { run, recorded } = start('allow-decline-interrupt.jsonl')
    run.send('1')
    run.respond((await blocked(run)).prompt.requestId, { kind: 'allow' })
    await next(run, (e) => e.type === 'turn_end')
    run.send('2')
    const b = await blocked(run)
    run.respond(b.prompt.requestId, { kind: 'deny', reason: 'not this' })
    const end = (await next(run, (e) => e.type === 'turn_end')) as Extract<
      AgentEvent,
      { type: 'turn_end' }
    >
    expect(recorded()).toContainEqual({
      id: Number(b.prompt.requestId),
      result: { decision: 'decline' }
    })
    expect(end.denials).toBe(1)
    await run.stop()
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

  it('refuses a server request it does not model, at once, and the turn goes on', async () => {
    const extra = JSON.stringify({
      id: 900,
      method: 'item/tool/call',
      params: { tool: 'x' }
    })
    const { run, recorded } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_EXTRA_REQUEST: extra
    })
    run.send('1')
    const b = await blocked(run)
    expect(recorded().find((m) => m.id === 900)?.error?.code).toBe(-32601)
    run.respond(b.prompt.requestId, { kind: 'allow' })
    await next(run, (e) => e.type === 'turn_end')
    await run.stop()
  })

  it('answers a question by question id, and never logs a secret answer', async () => {
    const extra = JSON.stringify({
      id: 901,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 't',
        turnId: 'u',
        itemId: 'i',
        isBlocking: true,
        questions: [
          {
            id: 'tok',
            header: 'Token',
            question: 'Paste it',
            isOther: false,
            isSecret: true,
            options: null
          }
        ]
      }
    })
    const { run, recorded, logPath } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_EXTRA_REQUEST: extra
    })
    run.send('1')
    const q = await blocked(run)
    expect(q.prompt.kind).toBe('question')
    run.respond(q.prompt.requestId, {
      kind: 'answers',
      answers: { tok: 's3cret-value' }
    })
    run.respond((await blocked(run)).prompt.requestId, { kind: 'allow' })
    await next(run, (e) => e.type === 'turn_end')
    await run.stop()
    expect(recorded()).toContainEqual({
      id: 901,
      result: { answers: { tok: { answers: ['s3cret-value'] } } }
    })
    expect(readFileSync(logPath, 'utf8')).not.toMatch(/s3cret-value/u)
  })

  it('grants a permission request for this turn only, or nothing on Deny', async () => {
    const extra = JSON.stringify({
      id: 902,
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 't',
        turnId: 'u',
        itemId: 'i',
        environmentId: null,
        startedAtMs: 0,
        cwd: '/p',
        reason: 'install deps',
        permissions: { network: { enabled: true }, fileSystem: null }
      }
    })
    const { run, recorded } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_EXTRA_REQUEST: extra
    })
    run.send('1')
    const p = await blocked(run)
    run.respond(p.prompt.requestId, { kind: 'allow' })
    run.respond((await blocked(run)).prompt.requestId, { kind: 'allow' })
    await next(run, (e) => e.type === 'turn_end')
    await run.stop()
    expect(recorded()).toContainEqual({
      id: 902,
      result: { permissions: { network: { enabled: true } }, scope: 'turn' }
    })

    const denied = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_EXTRA_REQUEST: extra
    })
    denied.run.send('1')
    denied.run.respond((await blocked(denied.run)).prompt.requestId, {
      kind: 'deny'
    })
    denied.run.respond((await blocked(denied.run)).prompt.requestId, {
      kind: 'allow'
    })
    await next(denied.run, (e) => e.type === 'turn_end')
    await denied.run.stop()
    expect(denied.recorded()).toContainEqual({
      id: 902,
      result: { permissions: {}, scope: 'turn' }
    })
  })

  it('clears a prompt Codex resolved itself, and a late Allow then answers false', async () => {
    const { run, recorded } = start('allow-decline-interrupt.jsonl')
    run.send('1')
    const b = await blocked(run)
    const answered = next(
      run,
      (e) => e.type === 'answered' && e.requestId === b.prompt.requestId
    )
    run.interrupt()
    await answered
    await next(run, (e) => e.type === 'turn_end')
    expect(run.respond(b.prompt.requestId, { kind: 'allow' })).toBe(false)
    expect(recorded().some((m) => m.id === Number(b.prompt.requestId))).toBe(
      false
    )
    await run.stop()
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
})
