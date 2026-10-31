// tests/unit/main/lib/agents/claude-code/protocol.test.ts
import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  describeInput,
  parseLine,
  summarizeInput
} from '@main/lib/agents/claude-code/protocol'
import type { AgentEvent } from '@main/lib/agents/driver'
import { describe, expect, it } from 'vitest'

const FIX = resolve(import.meta.dirname, '../../../../../fixtures/claude-code')
const lines = (name: string) =>
  readFileSync(resolve(FIX, name), 'utf8').split('\n').filter(Boolean)
const eventsOf = (name: string): AgentEvent[] =>
  lines(name).flatMap((l) => parseLine(l).events)

const PROBE =
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1792450800,"rateLimitType":"seven_day","utilization":0.85,"overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"surpassedThreshold":0.75,"unifiedWindows":{"five_hour":{"utilization":0.05,"resetsAt":1792159800},"seven_day":{"utilization":0.85,"resetsAt":1792450800}},"overageEnabled":false},"uuid":"u","session_id":"s"}'

describe('Claude Code protocol', () => {
  it('reads complete background task snapshots, excluding ambient watchers', () => {
    expect(
      parseLine(
        JSON.stringify({
          type: 'system',
          subtype: 'background_tasks_changed',
          tasks: [
            { task_id: 'bash-1' },
            { task_id: 'agent-1', ambient: false },
            { task_id: 'watcher', ambient: true },
            { task_id: 42 }
          ]
        })
      ).events
    ).toEqual([{ type: 'background_tasks', taskIds: ['bash-1', 'agent-1'] }])
    expect(
      parseLine(
        JSON.stringify({
          type: 'system',
          subtype: 'background_tasks_changed',
          tasks: []
        })
      ).events
    ).toEqual([{ type: 'background_tasks', taskIds: [] }])
    expect(
      parseLine(
        JSON.stringify({ type: 'system', subtype: 'background_tasks_changed' })
      ).events
    ).toEqual([])
  })
  it('maps the allow / write / bash / question run in order', () => {
    const types = eventsOf('allow-write-bash-question.jsonl').map((e) => e.type)
    expect(types[0]).toBe('init')
    expect(types).toContain('step_start')
    expect(types.filter((t) => t === 'turn_end')).toHaveLength(3)
    expect(types.filter((t) => t === 'blocked')).toHaveLength(2) // the Write, the question
  })

  it('reads the session id and model from init', () => {
    const init = eventsOf('allow-write-bash-question.jsonl')[0]
    expect(init).toMatchObject({
      type: 'init',
      model: 'claude-haiku-4-5-20251001'
    })
    expect((init as { cliSessionId: string }).cliSessionId).toMatch(
      /^[0-9a-f-]{36}$/
    )
  })

  it('turns a permission request into a prompt and keeps the input for the answer', () => {
    const line = lines('allow-write-bash-question.jsonl').find((l) =>
      l.includes('"control_request"')
    )!
    const parsed = parseLine(line)
    expect(parsed.events).toEqual([
      {
        type: 'blocked',
        prompt: {
          kind: 'permission',
          requestId: parsed.control!.requestId,
          tool: 'Write',
          summary: '/tmp/actovia-project/hello.txt',
          detail: '/tmp/actovia-project/hello.txt\n\nhi from actovia'
        }
      }
    ])
    expect(parsed.control).toMatchObject({
      toolName: 'Write',
      input: { file_path: '/tmp/actovia-project/hello.txt' }
    })
  })

  it('turns AskUserQuestion into a question prompt with its options', () => {
    const line = lines('allow-write-bash-question.jsonl').find(
      (l) => l.includes('"can_use_tool"') && l.includes('AskUserQuestion')
    )!
    const [e] = parseLine(line).events
    expect(e).toMatchObject({
      type: 'blocked',
      prompt: {
        kind: 'question',
        questions: [
          {
            question: 'Which color do you prefer?',
            multiSelect: false,
            options: [{ label: 'Red' }, { label: 'Blue' }]
          }
        ]
      }
    })
  })

  it('reports a turn end with text and denials, and no cost', () => {
    const ends = eventsOf('deny-interrupt-continue.jsonl').filter(
      (e) => e.type === 'turn_end'
    )
    expect(ends[0]).toMatchObject({ ok: true, interrupted: false, denials: 1 })
    expect(ends[1]).toMatchObject({ ok: false }) // error_during_execution after the interrupt
    expect(ends[0]).not.toHaveProperty('costUsd')
  })

  // ISSUE-132: the turn's tokens, cache included.
  it("reports the turn's tokens", () => {
    const ends = eventsOf('deny-interrupt-continue.jsonl').filter(
      (e) => e.type === 'turn_end'
    )
    expect(ends[0]).toMatchObject({
      usage: { inputTokens: 4 + 4865 + 63616, outputTokens: 267 }
    })
  })

  it('streams text deltas that add up to the final text', () => {
    const evs = eventsOf('partial-messages.jsonl')
    const streamed = evs
      .filter((e) => e.type === 'text_delta')
      .map((e) => (e as { delta: string }).delta)
      .join('')
    const final = evs.find((e) => e.type === 'text') as { text: string }
    expect(streamed).toBe(final.text)
  })

  it('pairs each tool result with its step', () => {
    const evs = eventsOf('allow-write-bash-question.jsonl')
    const starts = evs
      .filter((e) => e.type === 'step_start')
      .map((e) => (e as { id: string }).id)
    const ends = evs
      .filter((e) => e.type === 'step_end')
      .map((e) => (e as { id: string }).id)
    expect(ends.every((id) => starts.includes(id))).toBe(true)
  })

  it('ignores what it does not know, and lines that are not JSON', () => {
    expect(
      parseLine('{"type":"system","subtype":"hook_started"}').events
    ).toEqual([])
    expect(
      parseLine('{"type":"system","subtype":"thinking_tokens","n":3}').events
    ).toEqual([])
    expect(parseLine('Warning: something on stdout').events).toEqual([])
    expect(parseLine('').events).toEqual([])
  })

  it('passes a rate-limit notice through only when not allowed', () => {
    const { events } = parseLine(
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1791555000,"rateLimitType":"five_hour"}}'
    )
    const e = events.find((x) => x.type === 'notice')
    expect(e).toMatchObject({ type: 'notice' })
    expect((e as { text: string }).text).toMatch(/rejected/)
  })

  it('turns every rate_limit_event into a quota reading (the 2026-10-16 probe)', () => {
    const { events } = parseLine(PROBE)
    const q = events.find((e) => e.type === 'quota')
    expect(q).toMatchObject({
      type: 'quota',
      quota: {
        cli: 'claude-code',
        state: 'warning',
        overage: false,
        rejectedWindow: null,
        windows: [
          { name: 'five_hour', usedPercent: 5, resetsAt: 1792159800_000 },
          { name: 'seven_day', usedPercent: 85, resetsAt: 1792450800_000 }
        ]
      }
    })
    // allowed_warning is not `allowed`: the card keeps its quiet notice line.
    expect(events.some((e) => e.type === 'notice')).toBe(true)
  })

  it('an allowed reading is a quota event and no notice', () => {
    const { events } = parseLine(
      '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","unifiedWindows":{"five_hour":{"utilization":0.1,"resetsAt":1792159800}}}}'
    )
    expect(events.map((e) => e.type)).toEqual(['quota'])
  })

  it('keeps a window it does not know by name, a model’s own one marked', () => {
    const { events } = parseLine(
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"seven_day_opus","utilization":1,"resetsAt":1792450800}}'
    )
    const q = events.find((e) => e.type === 'quota') as Extract<
      AgentEvent,
      { type: 'quota' }
    >
    expect(q.quota.state).toBe('rejected')
    expect(q.quota.rejectedWindow).toBe('seven_day_opus')
    expect(q.quota.windows).toEqual([
      {
        name: 'seven_day_opus',
        usedPercent: 100,
        resetsAt: 1792450800_000,
        model: 'opus',
        rejected: true
      }
    ])
  })

  it('marks only the window it rejected on, not the others', () => {
    const { events } = parseLine(
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"five_hour","unifiedWindows":{"five_hour":{"utilization":1,"resetsAt":1792450800},"seven_day":{"utilization":0.4,"resetsAt":1792450900}}}}'
    )
    const q = events.find((e) => e.type === 'quota') as Extract<
      AgentEvent,
      { type: 'quota' }
    >
    expect(q.quota.windows.map((w) => [w.name, w.rejected === true])).toEqual([
      ['five_hour', true],
      ['seven_day', false]
    ])
  })

  it('summarises a tool input in one line', () => {
    expect(
      summarizeInput('Bash', {
        command: 'npm install\nnpm test',
        description: 'x'
      })
    ).toBe('npm install')
    expect(summarizeInput('Grep', { pattern: 'TODO' })).toBe('TODO')
    expect(summarizeInput('Unknown', {})).toBe('')
  })

  const permissionLine = (tool: string, input: unknown) =>
    JSON.stringify({
      type: 'control_request',
      request_id: 'r1',
      request: { subtype: 'can_use_tool', tool_name: tool, input }
    })

  it('shows the whole command while the summary stays one line', () => {
    const [e] = parseLine(
      permissionLine('Bash', { command: 'ls\nrm -rf ~' })
    ).events
    expect(e).toMatchObject({
      prompt: { summary: 'ls', detail: 'ls\nrm -rf ~' }
    })
  })

  it('shows old and new strings of an edit', () => {
    const d = describeInput('Edit', {
      file_path: '/a.ts',
      old_string: 'foo',
      new_string: 'bar'
    })
    expect(d).toBe('/a.ts\n\n--- old\nfoo\n+++ new\nbar')
    expect(
      describeInput('MultiEdit', {
        file_path: '/a.ts',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' }
        ]
      })
    ).toContain('--- old\nc\n+++ new\nd')
  })

  it("leaves out an edit's default replace_all: false", () => {
    expect(
      describeInput('Edit', {
        file_path: '/a.ts',
        old_string: 'a',
        new_string: 'b',
        replace_all: false
      })
    ).toBe('/a.ts\n\n--- old\na\n+++ new\nb')
  })

  it('never cuts a long command', () => {
    const command = 'x'.repeat(25_000)
    expect(describeInput('Bash', { command })).toBe(command)
  })

  it('shows every field the main rendering leaves out', () => {
    expect(
      describeInput('Edit', {
        file_path: '/a.ts',
        old_string: 'a',
        new_string: 'b',
        replace_all: true
      })
    ).toBe(
      '/a.ts\n\n--- old\na\n+++ new\nb\n\nOther fields:\n{\n  "replace_all": true\n}'
    )
    const bash = describeInput('Bash', {
      command: 'ls',
      description: 'list',
      run_in_background: true
    })
    expect(bash).toContain('Other fields:')
    expect(bash).toContain('"description": "list"')
    expect(bash).toContain('"run_in_background": true')
  })

  it('renders a non-Bash tool with a command field as full JSON', () => {
    expect(describeInput('Mystery', { command: 'ls', force: true })).toBe(
      JSON.stringify({ command: 'ls', force: true }, null, 2)
    )
  })

  it('shows a non-object MultiEdit entry', () => {
    expect(
      describeInput('MultiEdit', { file_path: '/a', edits: ['sneaky', 7] })
    ).toContain('"sneaky"')
  })

  it('shows an unknown tool as pretty JSON', () => {
    expect(describeInput('Mystery', { a: 1 })).toBe('{\n  "a": 1\n}')
  })

  describe('describeInput keeps every key', () => {
    // every key shows by name (in a JSON block) or, rendered, by its string value
    const shown = (d: string, o: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'edits' && Array.isArray(v)) {
          for (const e of v)
            if (e && typeof e === 'object')
              shown(d, e as Record<string, unknown>)
        } else {
          expect(
            d.includes(`"${k}"`) || (typeof v === 'string' && d.includes(v))
          ).toBe(true)
        }
      }
    }
    const keysIn = shown
    const cases: Array<[string, Record<string, unknown>, string]> = [
      [
        'MultiEdit',
        {
          file_path: '/a',
          edits: [{ old_string: 'a', new_string: 'b', replace_all: true }]
        },
        'replace_all'
      ],
      [
        'MultiEdit',
        {
          file_path: '/a',
          edits: [{ old_string: 'a', new_string: 'b', sneaky: 1 }]
        },
        'sneaky'
      ],
      ['Write', { file_path: '/a', content: { evil: 1 } }, '"evil": 1'],
      [
        'Edit',
        { file_path: '/a', old_string: 5, new_string: 'b' },
        '"old_string": 5'
      ],
      [
        'MultiEdit',
        { file_path: ['/x'], edits: [{ old_string: 'a', new_string: 'b' }] },
        '"/x"'
      ]
    ]
    it.each(cases)('%s %j', (tool, input, shown) => {
      const d = describeInput(tool, input)
      keysIn(d, input)
      expect(d).toContain(shown)
    })
  })
})
