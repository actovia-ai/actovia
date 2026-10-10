// tests/unit/main/lib/agents/codex/protocol.test.ts
import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  createCodexParser,
  describeCommand,
  describeFileChange,
  describePermissions
} from '@main/lib/agents/codex/protocol'
import type { AgentEvent } from '@main/lib/agents/driver'
import { describe, expect, it } from 'vitest'

const FIX = resolve(import.meta.dirname, '../../../../../fixtures/codex')
const lines = (name: string) =>
  readFileSync(resolve(FIX, name), 'utf8').split('\n').filter(Boolean)

function replay(name: string) {
  const parser = createCodexParser()
  parser.setThread('01a1245d-2907-72f3-9b06-3dc67f153940', 'gpt-5.6-terra')
  const events: AgentEvent[] = []
  const pendings: unknown[] = []
  for (const l of lines(name)) {
    const p = parser.parse(l)
    events.push(...p.events)
    if (p.pending) pendings.push(p.pending)
  }
  return { events, pendings }
}

describe('Codex protocol', () => {
  it('maps the recorded run: four turns, the third interrupted, one change declined', () => {
    const { events } = replay('allow-decline-interrupt.jsonl')
    const ends = events.filter((e) => e.type === 'turn_end') as Extract<
      AgentEvent,
      { type: 'turn_end' }
    >[]
    expect(ends.map((e) => [e.ok, e.interrupted])).toEqual([
      [true, false],
      [true, false],
      [false, true],
      [true, false]
    ])
    expect(ends[1].denials).toBe(1)
    expect(ends[0].text).toMatch(/hello\.txt/u)
    expect(events.filter((e) => e.type === 'init')).toHaveLength(4)
  })

  it('turns the file-change approval into a prompt carrying the diff of the item announced before it', () => {
    const { events } = replay('allow-decline-interrupt.jsonl')
    const first = events.find((e) => e.type === 'blocked') as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    expect(first.prompt).toMatchObject({ kind: 'permission', tool: 'Edit' })
    expect(first.prompt.kind === 'permission' && first.prompt.detail).toMatch(
      /hello\.txt[\s\S]*hi from exodus/u
    )
  })

  it('turns a command approval into a prompt with the whole command and its folder', () => {
    const { events } = replay('allow-decline-interrupt.jsonl')
    const cmd = events.find(
      (e) =>
        e.type === 'blocked' &&
        e.prompt.kind === 'permission' &&
        e.prompt.tool === 'Bash'
    ) as Extract<AgentEvent, { type: 'blocked' }>
    expect(cmd.prompt.kind === 'permission' && cmd.prompt.detail).toMatch(
      /sleep 20 && echo done[\s\S]*\/tmp\/exodus-project/u
    )
  })

  it('records each approval as pending with its JSON-RPC id', () => {
    const { pendings } = replay('allow-decline-interrupt.jsonl')
    expect(pendings).toHaveLength(4)
    expect(pendings[0]).toMatchObject({
      kind: 'fileChange',
      requestId: String((pendings[0] as { rpcId: number }).rpcId)
    })
  })

  it('pairs steps: every step that ends was started, declined ends as an error', () => {
    const { events } = replay('allow-decline-interrupt.jsonl')
    const starts = new Set(
      events
        .filter((e) => e.type === 'step_start')
        .map((e) => (e as { id: string }).id)
    )
    const ends = events.filter((e) => e.type === 'step_end') as Extract<
      AgentEvent,
      { type: 'step_end' }
    >[]
    expect(ends.every((e) => starts.has(e.id))).toBe(true)
    expect(ends.some((e) => e.isError)).toBe(true)
  })

  it('streams deltas that add up to the message', () => {
    const { events } = replay('resume.jsonl')
    const streamed = events
      .filter((e) => e.type === 'text_delta')
      .map((e) => (e as { delta: string }).delta)
      .join('')
    const final = events
      .filter((e) => e.type === 'text')
      .map((e) => (e as { text: string }).text)
      .join('')
    expect(streamed).toBe(final)
  })

  it('says so when a file change was never shown', () => {
    expect(
      describeFileChange({ itemId: 'x', reason: null }, undefined)
    ).toMatch(/wasn.t shown/u)
  })

  it('keeps every field it does not render', () => {
    const d = describeCommand({
      command: 'curl x',
      cwd: '/p',
      reason: 'net',
      networkApprovalContext: { host: 'x' },
      threadId: 't',
      itemId: 'i'
    })
    expect(d).toMatch(/curl x/u)
    expect(d).toMatch(/networkApprovalContext/u)
    expect(d).not.toMatch(/threadId/u)
  })

  it('names the access a permission request asks for', () => {
    const d = describePermissions({
      cwd: '/p',
      reason: 'install',
      permissions: { network: { enabled: true }, fileSystem: null }
    })
    expect(d).toMatch(/install/u)
    expect(d).toMatch(/network/u)
  })

  it('makes a question prompt from requestUserInput, keeping ids and flags', () => {
    const p = createCodexParser()
    const out = p.parse(
      JSON.stringify({
        id: 9,
        method: 'item/tool/requestUserInput',
        params: {
          threadId: 't',
          turnId: 'u',
          itemId: 'i',
          isBlocking: true,
          questions: [
            {
              id: 'q1',
              header: 'Token',
              question: 'Paste the token',
              isOther: false,
              isSecret: true,
              options: null
            }
          ]
        }
      })
    )
    expect(out.pending).toMatchObject({
      kind: 'userInput',
      rpcId: 9,
      requestId: '9'
    })
    expect(out.events[0]).toMatchObject({
      type: 'blocked',
      prompt: {
        kind: 'question',
        questions: [{ id: 'q1', isSecret: true, isOther: false, options: [] }]
      }
    })
  })

  it('refuses an MCP elicitation and anything it does not model, with a notice', () => {
    const p = createCodexParser()
    const e = p.parse(
      JSON.stringify({
        id: 4,
        method: 'mcpServer/elicitation/request',
        params: {}
      })
    )
    expect(e.refusal).toEqual({
      rpcId: 4,
      result: { action: 'decline', content: null }
    })
    expect(e.events[0]).toMatchObject({ type: 'notice' })
    const t = p.parse(
      JSON.stringify({ id: 5, method: 'item/tool/call', params: {} })
    )
    expect(t.refusal?.error?.code).toBe(-32601)
    expect(t.pending).toBeUndefined()
  })

  it("passes responses to Exodus' own requests through, and ignores noise", () => {
    const p = createCodexParser()
    expect(
      p.parse(JSON.stringify({ id: 2, result: { thread: { id: 't' } } }))
        .response
    ).toEqual({ id: 2, result: { thread: { id: 't' } } })
    expect(p.parse('not json').events).toEqual([])
    expect(
      p.parse(JSON.stringify({ method: 'thread/status/changed', params: {} }))
        .events
    ).toEqual([])
  })
})
