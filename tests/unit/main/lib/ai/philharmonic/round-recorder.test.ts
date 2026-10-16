import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/logger', () => ({ logger: { warn: vi.fn() } }))
vi.mock('@main/lib/db/pm-round-queries', () => ({ appendRoundEvent: vi.fn() }))
vi.mock('@main/lib/logger/secret-mask', () => ({
  maskLogText: (t: string) => t
}))
const { createRoundRecorder, resultText } =
  await import('@main/lib/ai/philharmonic/round-recorder')

function rec() {
  const rows: Array<{
    seq: number
    kind: string
    payload: Record<string, unknown>
  }> = []
  const r = createRoundRecorder('c1', 'r1', {
    append: async (e) => {
      rows.push({ seq: e.seq, kind: e.kind, payload: e.payload })
    },
    mask: (t) => t.replaceAll('sk-secret', '•••• cret')
  })
  return { r, rows }
}

const assistant = (content: unknown[], usage?: unknown) => ({
  type: 'message_end',
  message: { role: 'assistant', content, stopReason: 'toolUse', usage }
})

describe('round recorder', () => {
  it('records a round in order: input, reports, thinking, text, call, result, usage', async () => {
    const { r, rows } = rec()
    r.input('user', 'build it')
    r.reports([{ messageId: 'm1', agentId: 'a1', name: 'Claude Code' }])
    r.onEvent(
      assistant(
        [
          { type: 'thinking', thinking: 'opus is out' },
          { type: 'text', text: 'Giving it to sonnet.' },
          { type: 'toolCall', id: 't1', name: 'delegateTask', arguments: {} }
        ],
        { input: 100, output: 20, cacheRead: 5, cost: { total: 0.01 } }
      )
    )
    r.onEvent({
      type: 'tool_execution_start',
      toolCallId: 't1',
      toolName: 'delegateTask',
      args: { employeeId: 'a2', instructions: 'use sk-secret' }
    })
    r.onEvent({
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'delegateTask',
      result: { content: [{ type: 'text', text: 'done' }] },
      isError: false
    })
    r.onEvent(
      assistant([{ type: 'text', text: 'All done.' }], {
        input: 50,
        output: 10,
        cacheRead: 0,
        cost: { total: 0.005 }
      })
    )
    await r.finish()
    expect(rows.map((x) => x.kind)).toEqual([
      'input',
      'reports',
      'thinking',
      'text',
      'tool_call',
      'tool_result',
      'text',
      'usage'
    ])
    expect(rows.map((x) => x.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(rows[4].payload).toEqual({
      toolCallId: 't1',
      name: 'delegateTask',
      args: { employeeId: 'a2', instructions: 'use •••• cret' }
    })
    expect(rows[5].payload).toEqual({
      toolCallId: 't1',
      name: 'delegateTask',
      text: 'done',
      isError: false
    })
    expect(rows[7].payload).toEqual({
      inputTokens: 150,
      outputTokens: 30,
      cacheReadTokens: 5,
      costUsd: 0.015
    })
  })

  it('counts delegations that ran and waits that were scheduled', async () => {
    const { r } = rec()
    const call = (id: string, name: string, text: string) => {
      r.onEvent({
        type: 'tool_execution_start',
        toolCallId: id,
        toolName: name,
        args: {}
      })
      r.onEvent({
        type: 'tool_execution_end',
        toolCallId: id,
        toolName: name,
        result: text,
        isError: false
      })
    }
    call('a', 'delegateTask', 'done')
    call('b', 'delegateTask', 'Not started: CC’s quota is used up')
    call('c', 'waitForQuota', 'Step parked. You will be woken at Tue 07:02.')
    call('d', 'waitForQuota', 'Refused: nothing blocks that employee')
    await expect(r.finish()).resolves.toEqual({ delegations: 1, waits: 1 })
  })

  it('keeps what was written and adds the error', async () => {
    const { r, rows } = rec()
    r.input('scheduled', 'Quota reset')
    r.error('provider 500', false)
    await r.finish()
    expect(rows.map((x) => x.kind)).toEqual(['input', 'error'])
    expect(rows[1].payload).toEqual({ message: 'provider 500', aborted: false })
  })

  it('a failed write is logged, never thrown, and later writes still happen', async () => {
    const rows: string[] = []
    let n = 0
    const r = createRoundRecorder('c1', 'r1', {
      append: async (e) => {
        if (n++ === 0) throw new Error('db down')
        rows.push(e.kind)
      },
      mask: (t) => t
    })
    r.input('user', 'x')
    r.error('y', true)
    await expect(r.finish()).resolves.toEqual({ delegations: 0, waits: 0 })
    expect(rows).toEqual(['error'])
  })

  it('skips empty thinking / text and records no usage when none was reported', async () => {
    const { r, rows } = rec()
    r.onEvent(
      assistant([
        { type: 'text', text: '' },
        { type: 'thinking', thinking: '', redacted: true }
      ])
    )
    await r.finish()
    expect(rows).toEqual([])
  })
})

describe('resultText', () => {
  it('reads text parts, a string, or JSON for anything else', () => {
    expect(resultText('plain')).toBe('plain')
    expect(
      resultText({
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' }
        ]
      })
    ).toBe('ab')
    expect(resultText({ details: { ok: 1 } })).toBe('{"details":{"ok":1}}')
    expect(resultText(undefined)).toBe('')
  })
})
