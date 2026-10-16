// tests/unit/main/lib/agents/codex/run-answers.test.ts — the owner’s answers on the wire
import { readFileSync } from 'fs'

import { beforeAll, describe, expect, it } from 'vitest'

import { THREAD, blocked, next, prepareFake, rpcIdOf, start } from './fake'

beforeAll(prepareFake)

describe('Codex run answers', () => {
  it('accepts a change on Allow with the request’s own id', async () => {
    const { run, recorded } = start('allow-decline-interrupt.jsonl')
    run.send('create hello.txt')
    const b = await blocked(run)
    expect(run.respond(b.prompt.requestId, { kind: 'allow' })).toBe(true)
    expect(run.respond(b.prompt.requestId, { kind: 'allow' })).toBe(false)
    await next(run, (e) => e.type === 'turn_end')
    expect(recorded()).toContainEqual({
      id: rpcIdOf(b.prompt.requestId),
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
      id: rpcIdOf(b.prompt.requestId),
      result: { decision: 'decline' }
    })
    expect(end.denials).toBe(1)
    await run.stop()
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
        threadId: THREAD,
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

  it('sends each pick as its own answer', async () => {
    const extra = JSON.stringify({
      id: 903,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: THREAD,
        turnId: 'u',
        itemId: 'i',
        isBlocking: true,
        questions: [
          {
            id: 'env',
            header: 'Env',
            question: 'Where?',
            isOther: true,
            isSecret: false,
            options: [{ label: 'staging', description: '' }]
          }
        ]
      }
    })
    const { run, recorded } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_EXTRA_REQUEST: extra
    })
    run.send('1')
    const q = await blocked(run)
    run.respond(q.prompt.requestId, {
      kind: 'answers',
      answers: { env: ['staging', 'my laptop, too'] }
    })
    run.respond((await blocked(run)).prompt.requestId, { kind: 'allow' })
    await next(run, (e) => e.type === 'turn_end')
    await run.stop()
    expect(recorded()).toContainEqual({
      id: 903,
      result: { answers: { env: { answers: ['staging', 'my laptop, too'] } } }
    })
  })

  it('grants a permission request for this turn only, or nothing on Deny', async () => {
    const extra = JSON.stringify({
      id: 902,
      method: 'item/permissions/requestApproval',
      params: {
        threadId: THREAD,
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
    expect(recorded().some((m) => m.id === rpcIdOf(b.prompt.requestId))).toBe(
      false
    )
    await run.stop()
  })
})
