import type {
  PmRoundEventDto,
  PmRoundEventKind
} from '@actovia/shared/types/pm-round'
import { describe, expect, it } from 'vitest'

import {
  describeRound,
  roundCounts,
  waitRefusalReason,
  wakeTimeOf
} from '@/lib/pm-round'

let seq = 0
const ev = (
  kind: PmRoundEventKind,
  payload: Record<string, unknown>
): PmRoundEventDto => ({
  seq: seq++,
  kind,
  payload,
  createdAt: '2026-10-17T10:00:00.000Z'
})
const call = (toolCallId: string, name: string, args = {}) =>
  ev('tool_call', { toolCallId, name, args })
const result = (
  toolCallId: string,
  name: string,
  text: string,
  isError = false
) => ev('tool_result', { toolCallId, name, text, isError })

describe('describeRound', () => {
  it('pairs each call with its result by toolCallId, in call order', () => {
    const lines = describeRound(
      [
        ev('input', { trigger: 'scheduled', text: 'Daily digest' }),
        ev('reports', {
          messages: [{ messageId: 'm1', agentId: 'a1', name: 'Ada' }]
        }),
        ev('thinking', { text: 'Let me plan.' }),
        call('t1', 'createPlan', { steps: [{ title: 'x' }] }),
        call('t2', 'askUser', { question: '?' }),
        result('t2', 'askUser', 'yes'),
        result('t1', 'createPlan', 'Plan created', true),
        ev('usage', {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          costUsd: 0.01
        }),
        ev('error', { message: 'boom', aborted: false })
      ],
      ''
    )
    expect(lines).toEqual([
      { kind: 'trigger', scheduled: true, text: 'Daily digest' },
      {
        kind: 'reports',
        reports: [{ messageId: 'm1', agentId: 'a1', name: 'Ada' }]
      },
      { kind: 'thinking', text: 'Let me plan.' },
      {
        kind: 'call',
        tool: 'createPlan',
        args: { steps: [{ title: 'x' }] },
        result: 'Plan created',
        isError: true,
        refused: false
      },
      {
        kind: 'call',
        tool: 'askUser',
        args: { question: '?' },
        result: 'yes',
        isError: false,
        refused: false
      },
      { kind: 'usage', inputTokens: 10, outputTokens: 5 },
      { kind: 'error', message: 'boom', aborted: false }
    ])
  })

  it("counts the cached part of the prompt as read — '14 in' was a 32k round", () => {
    const [line] = describeRound(
      [
        ev('usage', {
          inputTokens: 14,
          outputTokens: 3727,
          cacheReadTokens: 32498,
          cacheWriteTokens: 100,
          costUsd: 0.1
        })
      ],
      ''
    )
    expect(line).toMatchObject({ kind: 'usage', inputTokens: 32612 })
    // ISSUE-235: an older round's recorded cost is not read.
    expect(line).not.toHaveProperty('costUsd')
  })

  it('a call without a result has result null', () => {
    const [line] = describeRound(
      [call('t1', 'delegateTask', { employeeId: 'a1' })],
      ''
    )
    expect(line).toMatchObject({ kind: 'call', result: null, refused: false })
  })

  it('a delegateTask whose result starts with "Not started:" is refused', () => {
    const lines = describeRound(
      [
        call('t1', 'delegateTask', { employeeId: 'a1' }),
        result('t1', 'delegateTask', 'Not started: the quota is used up'),
        call('t2', 'waitForQuota', {}),
        result('t2', 'waitForQuota', 'Not started: unrelated')
      ],
      ''
    )
    expect(lines.map((l) => l.kind === 'call' && l.refused)).toEqual([
      true,
      false
    ])
  })

  it('a waitForQuota whose result starts with "Refused" is refused', () => {
    const lines = describeRound(
      [
        call('t1', 'waitForQuota', {}),
        result('t1', 'waitForQuota', 'Refused: no step s9 in the plan.'),
        call('t2', 'waitForQuota', {}),
        result(
          't2',
          'waitForQuota',
          'Step parked. You will be woken at Tue 07:00.'
        )
      ],
      ''
    )
    expect(lines.map((l) => l.kind === 'call' && l.refused)).toEqual([
      true,
      false
    ])
  })

  it('drops the last text line when it is the bubble’s own text', () => {
    const lines = describeRound(
      [
        ev('text', { text: 'Working on it.' }),
        call('t1', 'createReport'),
        ev('text', { text: ' All done. ' })
      ],
      'All done.'
    )
    expect(lines.map((l) => l.kind)).toEqual(['text', 'call'])
  })

  it('keeps a last text that differs from the bubble', () => {
    const lines = describeRound([ev('text', { text: 'Interim' })], 'Final')
    expect(lines).toEqual([{ kind: 'text', text: 'Interim' }])
  })
})

describe('roundCounts', () => {
  it('counts started delegations and waits that were not refused', () => {
    expect(
      roundCounts([
        call('t1', 'delegateTask'),
        result('t1', 'delegateTask', 'Done'),
        call('t2', 'delegateTask'),
        result('t2', 'delegateTask', 'Not started: quota'),
        call('t3', 'waitForQuota'),
        result('t3', 'waitForQuota', 'Waiting until 10:00'),
        call('t4', 'waitForQuota'),
        result('t4', 'waitForQuota', 'Refused: another employee can do it'),
        call('t5', 'createPlan')
      ])
    ).toEqual({ delegations: 1, waits: 1 })
  })
})

describe('waitRefusalReason / wakeTimeOf', () => {
  it('reads the reason after "Refused: "', () => {
    expect(waitRefusalReason('Refused: no step s9 in the plan.')).toBe(
      'no step s9 in the plan.'
    )
    expect(waitRefusalReason(null)).toBe('')
  })

  it('reads the wake time between "woken at " and the next "."', () => {
    expect(
      wakeTimeOf(
        'Step parked. You will be woken at Tue 07:00. End your turn now.'
      )
    ).toBe('Tue 07:00')
    expect(wakeTimeOf('Step parked.')).toBeNull()
    expect(wakeTimeOf(null)).toBeNull()
  })
})
