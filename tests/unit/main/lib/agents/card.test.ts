import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  applyAgentEvent,
  cardText,
  newCard,
  touchedFiles
} from '@main/lib/agents/card'
import { parseLine } from '@main/lib/agents/claude-code/protocol'
import type { AgentEvent } from '@main/lib/agents/driver'
import { describe, expect, it } from 'vitest'

const FIX = resolve(import.meta.dirname, '../../../../fixtures/claude-code')
const events = (name: string): AgentEvent[] =>
  readFileSync(resolve(FIX, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => parseLine(l).events)
const base = () =>
  newCard({
    sessionId: 's',
    agentId: 'a',
    runtime: 'claude-code',
    model: null,
    projectName: 'p',
    cwd: '/p',
    branch: null
  })

describe('agent card', () => {
  it('a quota reading leaves the card as it is', () => {
    const card = base()
    expect(
      applyAgentEvent(card, {
        type: 'quota',
        quota: {
          cli: 'claude-code',
          windows: [],
          state: 'ok',
          rejectedWindow: null,
          overage: false,
          asOf: 1
        }
      })
    ).toBe(card)
  })

  it('ends a recorded run done, with steps ticked and the text kept', () => {
    const card = events('allow-write-bash-question.jsonl').reduce(
      (c, e) => applyAgentEvent(c, e),
      base()
    )
    expect(card.state).toBe('done')
    expect(card.steps.map((s) => [s.tool, s.status])).toEqual([
      ['Write', 'ok'],
      ['Bash', 'ok'],
      ['AskUserQuestion', 'ok']
    ])
    expect(card).not.toHaveProperty('costUsd')
    expect(cardText(card)).toMatch(/You chose Blue!/u)
    expect(card.prompts).toEqual([])
    expect(touchedFiles(card)).toEqual(['/tmp/actovia-project/hello.txt'])
  })

  it('is blocked while a prompt waits and working again once it is answered', () => {
    const blocked = applyAgentEvent(base(), {
      type: 'blocked',
      prompt: {
        kind: 'permission',
        requestId: 'r1',
        tool: 'Bash',
        summary: 'npm i'
      }
    })
    expect(blocked.state).toBe('blocked')
    const answered = applyAgentEvent(blocked, {
      type: 'answered',
      requestId: 'r1'
    })
    expect(answered).toMatchObject({ state: 'working', prompts: [] })
  })

  it('counts a denial, is stopped after an interrupted turn, and done after the next', () => {
    const evs = events('deny-interrupt-continue.jsonl')
    const ends = evs.flatMap((e, i) => (e.type === 'turn_end' ? [i] : []))
    // The run (Task 6) marks the turn it interrupted; the parser cannot know.
    const marked = evs.map((e, i) =>
      i === ends[1] ? ({ ...e, interrupted: true } as AgentEvent) : e
    )
    const afterInterrupt = marked
      .slice(0, ends[1] + 1)
      .reduce((card, e) => applyAgentEvent(card, e), base())
    expect(afterInterrupt.state).toBe('stopped')
    expect(afterInterrupt.denials).toBe(1)
    expect(
      marked.reduce((card, e) => applyAgentEvent(card, e), base()).state
    ).toBe('done')
  })

  it('streams text into pending and settles it into a block', () => {
    let c = applyAgentEvent(base(), { type: 'text_delta', delta: 'Hel' })
    c = applyAgentEvent(c, { type: 'text_delta', delta: 'lo' })
    expect(cardText(c)).toBe('Hello')
    c = applyAgentEvent(c, { type: 'text', text: 'Hello' })
    expect(c).toMatchObject({ blocks: ['Hello'], pending: '' })
  })

  it('reopens a done card for an unprompted turn', () => {
    let c = applyAgentEvent(base(), {
      type: 'turn_end',
      ok: true,
      interrupted: false,
      text: 'ok',
      denials: 0
    })
    expect(c.state).toBe('done')
    c = applyAgentEvent(c, { type: 'init', cliSessionId: 'x', model: null })
    expect(c.state).toBe('working')
  })

  it('fails on an unexpected exit mid-turn with the stderr tail, but not after done', () => {
    const failed = applyAgentEvent(base(), {
      type: 'exit',
      code: 1,
      stderrTail: 'boom',
      expected: false
    })
    expect(failed).toMatchObject({ state: 'error', error: 'boom' })
    const quiet = applyAgentEvent(base(), {
      type: 'exit',
      code: 1,
      stderrTail: '',
      expected: false
    })
    expect(quiet.error).toBe('Claude Code exited (code 1).')
    const done = applyAgentEvent(base(), {
      type: 'turn_end',
      ok: true,
      interrupted: false,
      text: '',
      denials: 0
    })
    expect(
      applyAgentEvent(done, {
        type: 'exit',
        code: 0,
        stderrTail: '',
        expected: false
      }).state
    ).toBe('done')
  })

  it('keeps a repeated notice once', () => {
    let c = applyAgentEvent(base(), {
      type: 'notice',
      text: 'Rate limit: rejected'
    })
    c = applyAgentEvent(c, { type: 'notice', text: 'Rate limit: rejected' })
    expect(c.notices).toEqual(['Rate limit: rejected'])
  })
})
