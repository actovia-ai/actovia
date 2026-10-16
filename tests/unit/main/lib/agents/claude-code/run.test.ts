// tests/unit/main/lib/agents/claude-code/run.test.ts
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { buildArgs, startClaudeCode } from '@main/lib/agents/claude-code/run'
import type { AgentEvent, AgentRun } from '@main/lib/agents/driver'
import { beforeAll, describe, expect, it } from 'vitest'

const FIX = resolve(import.meta.dirname, '../../../../../fixtures/claude-code')
const FAKE = join(FIX, 'fake-claude.mjs')
beforeAll(() => chmodSync(FAKE, 0o755))

function start(
  fixture: string,
  extra: Record<string, string> = {},
  input: Partial<Parameters<typeof startClaudeCode>[0]> = {}
) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-run-'))
  const recordPath = join(dir, 'record.jsonl')
  const logPath = join(dir, 'raw.jsonl')
  const run = startClaudeCode({
    binPath: FAKE,
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? '',
      FAKE_CLAUDE_FIXTURE: join(FIX, fixture),
      FAKE_CLAUDE_RECORD: recordPath,
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
  return { run, events, recorded, logPath }
}

/** Resolves with the first event matching, or rejects after `ms`. */
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

describe('Claude Code run', () => {
  it('never passes a model that could be read as a flag', () => {
    const args = buildArgs({
      binPath: 'claude',
      cwd: '/p',
      env: {},
      permissionMode: 'default',
      model: '--dangerously-skip-permissions',
      logPath: '/l'
    })
    expect(args).not.toContain('--model')
    expect(args).not.toContain('--dangerously-skip-permissions')
  })

  it('builds the stream-json command line, never with bypassPermissions', () => {
    const args = buildArgs({
      binPath: 'claude',
      cwd: '/p',
      env: {},
      permissionMode: 'acceptEdits',
      model: 'opus',
      resume: 'abc',
      logPath: '/l'
    })
    expect(args).toEqual([
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
      'acceptEdits',
      '--model',
      'opus',
      '--resume',
      'abc'
    ])
    expect(args).not.toContain('bypassPermissions')
  })

  it('answers a permission with the original input, and sees the turn end', async () => {
    const { run, recorded } = start('allow-write-bash-question.jsonl')
    run.send('Create hello.txt')
    const blocked = (await next(run, (e) => e.type === 'blocked')) as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    expect(run.respond(blocked.prompt.requestId, { kind: 'allow' })).toBe(true)
    await next(run, (e) => e.type === 'turn_end')
    const answer = recorded().find((r) => r.stdin?.type === 'control_response')
    expect(answer.stdin.response).toMatchObject({
      subtype: 'success',
      request_id: blocked.prompt.requestId,
      response: {
        behavior: 'allow',
        updatedInput: { file_path: '/tmp/exodus-project/hello.txt' }
      }
    })
    expect(run.cliSessionId).toMatch(/^[0-9a-f-]{36}$/)
    await run.stop()
  })

  it('answers a question with the chosen labels in updatedInput.answers', async () => {
    const { run, recorded } = start('allow-write-bash-question.jsonl')
    run.send('turn 1')
    const b1 = (await next(run, (e) => e.type === 'blocked')) as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    run.respond(b1.prompt.requestId, { kind: 'allow' })
    await next(run, (e) => e.type === 'turn_end')
    run.send('turn 2')
    await next(run, (e) => e.type === 'turn_end')
    run.send('turn 3')
    const b3 = (await next(run, (e) => e.type === 'blocked')) as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    expect(b3.prompt.kind).toBe('question')
    run.respond(b3.prompt.requestId, {
      kind: 'answers',
      answers: { 'Which color do you prefer?': 'Blue' }
    })
    await next(run, (e) => e.type === 'turn_end')
    const last = recorded()
      .filter((r) => r.stdin?.type === 'control_response')
      .at(-1)
    expect(last.stdin.response.response.updatedInput.answers).toEqual({
      'Which color do you prefer?': 'Blue'
    })
    expect(last.stdin.response.response.updatedInput.questions).toHaveLength(1)
    await run.stop()
  })

  it('denies with the owner’s reason, and refuses a second answer to the same request', async () => {
    const { run, recorded } = start('deny-interrupt-continue.jsonl')
    run.send('Create secret.txt')
    const b = (await next(run, (e) => e.type === 'blocked')) as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    expect(
      run.respond(b.prompt.requestId, {
        kind: 'deny',
        reason: 'Use another name'
      })
    ).toBe(true)
    expect(run.respond(b.prompt.requestId, { kind: 'allow' })).toBe(false)
    await next(run, (e) => e.type === 'turn_end')
    const deny = recorded().find((r) => r.stdin?.type === 'control_response')
    expect(deny.stdin.response.response).toEqual({
      behavior: 'deny',
      message: 'Use another name'
    })
    await run.stop()
  })

  it('emits answered when a prompt is answered', async () => {
    const { run, events } = start('deny-interrupt-continue.jsonl')
    run.send('x')
    const b = (await next(run, (e) => e.type === 'blocked')) as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    run.respond(b.prompt.requestId, { kind: 'deny' })
    expect(events).toContainEqual({
      type: 'answered',
      requestId: b.prompt.requestId
    })
    await run.stop()
  })

  it('interrupts a running turn: the turn ends interrupted and the process lives on', async () => {
    const { run } = start('deny-interrupt-continue.jsonl')
    run.send('turn 1')
    const b = (await next(run, (e) => e.type === 'blocked')) as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    run.respond(b.prompt.requestId, { kind: 'deny' })
    await next(run, (e) => e.type === 'turn_end')
    run.send('write a long story')
    await next(run, (e) => e.type === 'init')
    expect(run.interrupt()).toBe(true)
    const end = await next(run, (e) => e.type === 'turn_end')
    expect(end).toMatchObject({ interrupted: true, ok: false })
    expect(run.alive).toBe(true)
    await run.stop()
  })

  it('reads lines split across chunks and skips a non-JSON line', async () => {
    const { run, events } = start('resume.jsonl', {
      FAKE_CLAUDE_SPLIT: '1',
      FAKE_CLAUDE_GARBAGE: '1'
    })
    run.send('hello')
    await next(run, (e) => e.type === 'turn_end')
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['init', 'text', 'turn_end'])
    )
    await run.stop()
  })

  it('reports an unexpected exit with stderr’s tail, and refuses writes after', async () => {
    const { run } = start('allow-write-bash-question.jsonl', {
      FAKE_CLAUDE_DIE_AFTER: '3'
    })
    run.send('go')
    const exit = await next(run, (e) => e.type === 'exit')
    expect(exit).toMatchObject({ code: 1, expected: false })
    expect((exit as { stderrTail: string }).stderrTail).toMatch(/boom/)
    expect(run.alive).toBe(false)
    expect(run.send('again')).toBe(false)
    expect(run.respond('nope', { kind: 'allow' })).toBe(false)
  })

  it('reports a spawn failure as an exit, not a throw', async () => {
    const run = startClaudeCode({
      binPath: '/nonexistent/claude',
      cwd: tmpdir(),
      env: {},
      permissionMode: 'default',
      logPath: join(mkdtempSync(join(tmpdir(), 'x-')), 'l')
    })
    const exit = await next(run, (e) => e.type === 'exit')
    expect(exit).toMatchObject({ code: null, expected: false })
  })

  it('catches an unprompted turn after the last answer', async () => {
    const { run } = start('deny-and-unprompted-turn.jsonl', {
      FAKE_CLAUDE_AUTOPLAY_AFTER: '3'
    })
    let ends = 0
    run.on((e) => {
      if (e.type === 'turn_end') ends++
    })
    run.send('1')
    const b = (await next(run, (e) => e.type === 'blocked')) as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    run.respond(b.prompt.requestId, { kind: 'deny' })
    await next(run, (e) => e.type === 'turn_end')
    run.send('2')
    await next(run, (e) => e.type === 'turn_end')
    run.send('3')
    await next(run, (e) => e.type === 'turn_end')
    await next(run, (e) => e.type === 'turn_end') // nobody asked for this one
    expect(ends).toBe(4)
    await run.stop()
  })

  it('logs every stdout line verbatim', async () => {
    const { run, logPath } = start('resume.jsonl')
    run.send('hello')
    await next(run, (e) => e.type === 'turn_end')
    await run.stop()
    const logged = readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
    expect(logged.length).toBe(
      readFileSync(join(FIX, 'resume.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean).length
    )
  })

  it('stop ends the process and marks the exit expected', async () => {
    const { run } = start('resume.jsonl')
    const exited = next(run, (e) => e.type === 'exit')
    await run.stop()
    expect(await exited).toMatchObject({ expected: true })
  })
  it('survives writes to a dying child: an exit event, no uncaught error', async () => {
    const uncaught: unknown[] = []
    const spy = (e: unknown) => uncaught.push(e)
    process.on('uncaughtException', spy)
    try {
      const { run } = start('allow-write-bash-question.jsonl', {
        FAKE_CLAUDE_DIE_AFTER: '2'
      })
      const exited = next(run, (e) => e.type === 'exit')
      const timer = setInterval(() => run.send('again'), 1)
      await exited
      clearInterval(timer)
      for (let i = 0; i < 20; i++) run.send('after')
      await new Promise((r) => setTimeout(r, 100))
      expect(uncaught).toEqual([])
    } finally {
      process.off('uncaughtException', spy)
    }
  })

  it('does not follow a symlink at the log path', async () => {
    const outside = join(mkdtempSync(join(tmpdir(), 'out-')), 'rc')
    writeFileSync(outside, 'keep\n')
    const link = join(mkdtempSync(join(tmpdir(), 'lnk-')), 'raw.jsonl')
    symlinkSync(outside, link)
    const { run } = start('resume.jsonl', {}, { logPath: link })
    run.send('hello')
    await next(run, (e) => e.type === 'turn_end')
    await run.stop()
    expect(readFileSync(outside, 'utf8')).toBe('keep\n')
  })

  it('does not append through a hard link at the log path, and still runs', async () => {
    const outside = join(mkdtempSync(join(tmpdir(), 'out-')), 'rc')
    writeFileSync(outside, 'keep\n')
    const hard = join(mkdtempSync(join(tmpdir(), 'hl-')), 'raw.jsonl')
    linkSync(outside, hard)
    const { run } = start('resume.jsonl', {}, { logPath: hard })
    run.send('hello')
    await next(run, (e) => e.type === 'turn_end')
    await run.stop()
    expect(readFileSync(outside, 'utf8')).toBe('keep\n')
  })

  it('runs a turn though the log cannot be written', async () => {
    const { run } = start(
      'resume.jsonl',
      {},
      { logPath: '/nonexistent-dir-for-exodus-test/raw.jsonl' }
    )
    run.send('hello')
    await next(run, (e) => e.type === 'turn_end')
    await run.stop()
  })

  it('logs every line and emits nothing after exit', async () => {
    const { run, events, logPath } = start('resume.jsonl')
    run.send('hello')
    await next(run, (e) => e.type === 'turn_end')
    await run.stop()
    expect(events.at(-1)?.type).toBe('exit')
    expect(events.filter((e) => e.type === 'exit')).toHaveLength(1)
    const logged = readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
    expect(logged.length).toBe(
      readFileSync(join(FIX, 'resume.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean).length
    )
  })
  it('reports exit as soon as the output closes, not after the drain cap', async () => {
    const { run } = start('resume.jsonl')
    run.send('hello')
    await next(run, (e) => e.type === 'turn_end')
    const t0 = Date.now()
    await run.stop()
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})
