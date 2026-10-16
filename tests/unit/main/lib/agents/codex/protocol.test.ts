// tests/unit/main/lib/agents/codex/protocol.test.ts
import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  createCodexParser,
  describeCommand,
  describeFileChange,
  describePermissions,
  quotaFromCodex
} from '@main/lib/agents/codex/protocol'
import type { AgentEvent } from '@main/lib/agents/driver'
import { describe, expect, it } from 'vitest'

const FIX = resolve(import.meta.dirname, '../../../../../fixtures/codex')
const lines = (name: string) =>
  readFileSync(resolve(FIX, name), 'utf8').split('\n').filter(Boolean)

function replay(name: string) {
  const parser = createCodexParser('n')
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
      requestId: `n:${(pendings[0] as { rpcId: number }).rpcId}`
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
    const p = createCodexParser('n')
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
      requestId: 'n:9'
    })
    expect(out.events[0]).toMatchObject({
      type: 'blocked',
      prompt: {
        kind: 'question',
        questions: [{ id: 'q1', isSecret: true, isOther: true, options: [] }]
      }
    })
  })

  it('refuses an MCP elicitation and anything it does not model, with a notice', () => {
    const p = createCodexParser('n')
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
    const p = createCodexParser('n')
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

  it('shows stdin input as input, and a set environmentId', () => {
    const p = createCodexParser('n')
    const out = p.parse(
      JSON.stringify({
        id: 1,
        method: 'item/commandExecution/requestApproval',
        params: {
          kind: 'writeStdin',
          command: 'rm -rf x',
          environmentId: 'env-7'
        }
      })
    )
    const prompt = (
      out.events[0] as {
        prompt: { tool: string; summary: string; detail: string }
      }
    ).prompt
    expect(prompt.tool).toBe('Stdin')
    expect(prompt.summary).toBe('Input to a running command')
    expect(prompt.detail).toMatch(
      /^Sends this input to a command that is already running:\nrm -rf x/u
    )
    expect(prompt.detail).toMatch(/env-7/u)
    const net = p.parse(
      JSON.stringify({
        id: 2,
        method: 'item/commandExecution/requestApproval',
        params: { networkApprovalContext: { host: 'x.com' } }
      })
    )
    expect(
      (net.events[0] as { prompt: { summary: string } }).prompt.summary
    ).toBe('Network access to x.com')
  })

  it('shows the latest diff after patchUpdated, and forgets it when the item completes', () => {
    const p = createCodexParser('n')
    const ch = (d: string) => [
      { path: 'a.txt', kind: { type: 'update' }, diff: d }
    ]
    const send = (o: unknown) => p.parse(JSON.stringify(o))
    send({
      method: 'item/started',
      params: { item: { id: 'f', type: 'fileChange', changes: ch('FIRST') } }
    })
    send({
      method: 'item/fileChange/patchUpdated',
      params: { itemId: 'f', changes: ch('SECOND') }
    })
    const req = {
      id: 3,
      method: 'item/fileChange/requestApproval',
      params: { itemId: 'f' }
    }
    const d = (send(req).events[0] as { prompt: { detail: string } }).prompt
      .detail
    expect(d).toMatch(/SECOND/u)
    expect(d).not.toMatch(/FIRST/u)
    send({
      method: 'item/completed',
      params: { item: { id: 'f', type: 'fileChange', status: 'completed' } }
    })
    expect(
      (send(req).events[0] as { prompt: { detail: string } }).prompt.detail
    ).toMatch(/wasn.t shown/u)
  })

  it('treats a question without options as free text', () => {
    const out = createCodexParser('n').parse(
      JSON.stringify({
        id: 1,
        method: 'item/tool/requestUserInput',
        params: { questions: [{ id: 'q', question: 'Name?', options: null }] }
      })
    )
    expect(out.events[0]).toMatchObject({
      prompt: { questions: [{ isOther: true }] }
    })
  })

  it('closes open steps at turn end and stays quiet on a retried error', () => {
    const p = createCodexParser('n')
    const send = (o: unknown) => p.parse(JSON.stringify(o))
    send({
      method: 'item/started',
      params: { item: { id: 's', type: 'webSearch', query: 'q' } }
    })
    const out = send({
      method: 'turn/completed',
      params: { turn: { status: 'interrupted' } }
    })
    expect(out.events.map((e) => e.type)).toEqual(['step_end', 'turn_end'])
    expect(out.events[0]).toMatchObject({ id: 's', isError: true })
    expect(
      send({ method: 'error', params: { message: 'x', willRetry: true } })
        .events
    ).toEqual([])
  })

  it('says which request Codex resolved itself, as Exodus keys it', () => {
    const p = createCodexParser('n')
    const out = p.parse(
      JSON.stringify({
        method: 'serverRequest/resolved',
        params: { threadId: 't', requestId: 0 }
      })
    )
    expect(out).toEqual({ events: [], resolved: 'n:0' })
    expect(
      p.parse(JSON.stringify({ method: 'serverRequest/resolved', params: {} }))
        .resolved
    ).toBeUndefined()
  })

  it('keys requests by the run’s nonce: another process’s request 0 is not this one’s', () => {
    const request = JSON.stringify({
      id: 0,
      method: 'item/commandExecution/requestApproval',
      params: { command: 'ls' }
    })
    expect(createCodexParser('a').parse(request).pending?.requestId).toBe('a:0')
    expect(createCodexParser('b').parse(request).pending?.requestId).toBe('b:0')
  })

  it('ignores another thread’s turns and items, and declines its requests', () => {
    const p = createCodexParser('n')
    p.setThread('mine', null)
    const parse = (m: object) => p.parse(JSON.stringify(m))
    expect(
      parse({
        method: 'turn/started',
        params: { threadId: 'other', turn: { id: 'x' } }
      })
    ).toEqual({ events: [] })
    expect(
      parse({
        method: 'item/agentMessage/delta',
        params: { threadId: 'other', delta: 'hi' }
      })
    ).toEqual({ events: [] })
    expect(
      parse({
        method: 'turn/completed',
        params: { threadId: 'other', turn: { id: 'x', status: 'completed' } }
      })
    ).toEqual({ events: [] })
    // This run's own thread, and messages naming none, still count.
    expect(
      parse({
        method: 'turn/completed',
        params: { threadId: 'mine', turn: { id: 'y', status: 'completed' } }
      }).events.at(-1)
    ).toMatchObject({ type: 'turn_end', ok: true })
    expect(
      parse({ method: 'item/agentMessage/delta', params: { delta: 'hi' } })
        .events
    ).toEqual([{ type: 'text_delta', delta: 'hi' }])

    const asked = parse({
      id: 3,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'other', command: 'rm -rf /' }
    })
    expect(asked.pending).toBeUndefined()
    expect(asked.refusal).toEqual({ rpcId: 3, result: { decision: 'decline' } })
    expect(asked.events).toEqual([
      { type: 'notice', text: expect.stringMatching(/another thread/u) }
    ])
    expect(
      parse({
        id: 4,
        method: 'item/permissions/requestApproval',
        params: {
          threadId: 'other',
          permissions: { network: { enabled: true } }
        }
      }).refusal
    ).toEqual({ rpcId: 4, result: { permissions: {}, scope: 'turn' } })
  })

  it('leaves no step open across the recorded interrupted turn', () => {
    const { events } = replay('allow-decline-interrupt.jsonl')
    const open = new Set<string>()
    for (const e of events) {
      if (e.type === 'step_start') open.add(e.id)
      if (e.type === 'step_end') open.delete(e.id)
    }
    expect([...open]).toEqual([])
  })
})

describe('Codex quota', () => {
  const READ = {
    ordinaryUsageAllowed: true,
    rateLimits: {
      limitId: 'codex',
      limitName: null,
      normalModelSlug: null,
      primary: {
        usedPercent: 12,
        windowDurationMins: 300,
        resetsAt: 1792159800
      },
      secondary: {
        usedPercent: 64,
        windowDurationMins: 10080,
        resetsAt: 1792450800
      },
      credits: { hasCredits: false, unlimited: false, balance: null },
      rateLimitReachedType: null
    },
    rateLimitsByLimitId: {
      codex: null,
      'gpt-5.6-pro': {
        limitId: 'gpt-5.6-pro',
        limitName: 'GPT-5.6 Pro',
        normalModelSlug: 'gpt-5.6-pro',
        primary: null,
        secondary: {
          usedPercent: 100,
          windowDurationMins: 10080,
          resetsAt: 1792450800
        },
        credits: null,
        rateLimitReachedType: 'rate_limit_reached'
      }
    }
  }

  it('reads the account windows and a per-model bucket (account/rateLimits/read)', () => {
    const q = quotaFromCodex(READ, 5)!
    expect(q).toMatchObject({
      cli: 'codex',
      state: 'rejected',
      overage: false,
      asOf: 5
    })
    expect(q.windows).toEqual([
      {
        name: 'primary',
        usedPercent: 12,
        resetsAt: 1792159800_000,
        durationMins: 300
      },
      {
        name: 'secondary',
        usedPercent: 64,
        resetsAt: 1792450800_000,
        durationMins: 10080
      },
      {
        name: 'GPT-5.6 Pro secondary',
        usedPercent: 100,
        resetsAt: 1792450800_000,
        durationMins: 10080,
        model: 'gpt-5.6-pro',
        rejected: true
      }
    ])
    expect(q.rejectedWindow).toBe('GPT-5.6 Pro secondary')
  })

  it('marks the account windows rejected when ordinary usage is not allowed', () => {
    const q = quotaFromCodex(
      {
        ordinaryUsageAllowed: false,
        rateLimits: { ...READ.rateLimits },
        rateLimitsByLimitId: {
          'gpt-5.6-pro': {
            ...READ.rateLimitsByLimitId['gpt-5.6-pro'],
            rateLimitReachedType: null,
            secondary: {
              usedPercent: 40,
              windowDurationMins: 10080,
              resetsAt: 1792450800
            }
          }
        }
      },
      1
    )!
    expect(q.state).toBe('rejected')
    expect(q.windows.map((w) => [w.name, w.rejected === true])).toEqual([
      ['primary', true],
      ['secondary', true],
      ['GPT-5.6 Pro secondary', false]
    ])
  })

  it('is ok while nothing is reached, whatever the percentages', () => {
    const q = quotaFromCodex(
      {
        rateLimits: {
          ...READ.rateLimits,
          primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 1 }
        }
      },
      1
    )!
    expect(q.state).toBe('ok')
  })

  it('a rolling update becomes a merge quota event', () => {
    const parser = createCodexParser('n')
    const { events } = parser.parse(
      JSON.stringify({
        method: 'account/rateLimits/updated',
        params: {
          rateLimits: {
            primary: {
              usedPercent: 30,
              windowDurationMins: 300,
              resetsAt: 1792159800
            }
          }
        }
      })
    )
    expect(events).toMatchObject([
      {
        type: 'quota',
        merge: true,
        quota: { cli: 'codex', windows: [{ name: 'primary', usedPercent: 30 }] }
      }
    ])
  })
})
