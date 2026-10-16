// @vitest-environment happy-dom
import { readFileSync } from 'fs'
import { join } from 'path'

import type { PmRoundEventDto } from '@exodus/shared/types/pm-round'
import i18n from 'i18next'
import { act, createElement } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../../helpers/query-test-utils'

const getPmRound = vi.hoisted(() => vi.fn())
vi.mock('@/services/philharmonic-rounds', () => ({ getPmRound }))

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const { DecisionProcess } =
  await import('@/components/philharmonic/chat/decision-process')
const { TEST_IDS } = await import('@exodus/shared/constants/test-ids')

const philharmonic = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../../packages/shared/src/i18n/locales/en/philharmonic.json'
    ),
    'utf8'
  )
)
const instance = i18n.createInstance()
await instance.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { philharmonic } },
  defaultNS: 'philharmonic'
})

let seq = 0
const ev = (
  kind: PmRoundEventDto['kind'],
  payload: Record<string, unknown>
): PmRoundEventDto => ({
  seq: seq++,
  kind,
  payload,
  createdAt: '2026-10-17T10:00:00.000Z'
})

const round: PmRoundEventDto[] = [
  ev('input', { trigger: 'user', text: 'Build the site' }),
  ev('reports', {
    messages: [
      { messageId: 'm8', agentId: 'a1', name: 'former employee' },
      { messageId: 'm9', agentId: 'gone', name: 'former employee' }
    ]
  }),
  ev('tool_call', {
    toolCallId: 't1',
    name: 'delegateTask',
    args: { employeeId: 'a1', instructions: 'Do it' }
  }),
  ev('tool_result', {
    toolCallId: 't1',
    name: 'delegateTask',
    text: 'Done.',
    isError: false
  }),
  ev('tool_call', {
    toolCallId: 't2',
    name: 'delegateTask',
    args: { employeeId: 'a1', instructions: 'Again' }
  }),
  ev('tool_result', {
    toolCallId: 't2',
    name: 'delegateTask',
    text: 'Not started: quota used up',
    isError: false
  }),
  ev('tool_call', {
    toolCallId: 't3',
    name: 'waitForQuota',
    args: { stepId: 's1', employeeId: 'a1', reason: 'r' }
  }),
  ev('tool_result', {
    toolCallId: 't3',
    name: 'waitForQuota',
    text: 'Waiting until 14:00',
    isError: false
  }),
  ev('usage', {
    inputTokens: 1200,
    outputTokens: 300,
    cacheReadTokens: 0,
    costUsd: 0.0123
  })
]

const roots: HTMLElement[] = []
afterEach(() => {
  roots.splice(0).forEach((h) => h.remove())
  getPmRound.mockReset()
})

async function mount(counts?: { delegations: number; waits: number }) {
  const onJumpTo = vi.fn()
  const { host } = await renderWithQueryClient(
    createElement(
      I18nextProvider,
      { i18n: instance },
      createElement(DecisionProcess, {
        conversationId: 'c1',
        roundId: 'r1',
        bubbleText: 'All done.',
        counts,
        nameOf: (id: string) => (id === 'a1' ? 'Claude Code' : undefined),
        onJumpTo
      })
    )
  )
  document.body.append(host)
  roots.push(host)
  return { host, onJumpTo }
}

const toggle = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>(
    `[data-testid="${TEST_IDS.philharmonic.decisionToggle}"]`
  )!

const open = async (host: HTMLElement) => {
  await act(async () => {
    toggle(host).click()
  })
  // Let the query resolve and render.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('DecisionProcess', () => {
  it('collapsed: shows the counts from the decision part and fetches nothing', async () => {
    const { host } = await mount({ delegations: 2, waits: 1 })
    expect(toggle(host).textContent).toBe(
      'Decision process · Delegated: 2 · Waited: 1'
    )
    expect(getPmRound).not.toHaveBeenCalled()
  })

  it('leaves counts of 0 out', async () => {
    const { host } = await mount({ delegations: 0, waits: 0 })
    expect(toggle(host).textContent).toBe('Decision process')
  })

  it('opened: draws every call as a sentence, the refusal, the wait and the usage', async () => {
    getPmRound.mockResolvedValue(round)
    const { host, onJumpTo } = await mount({ delegations: 1, waits: 1 })
    await open(host)
    expect(getPmRound).toHaveBeenCalledWith('c1', 'r1')
    const text = host.textContent ?? ''
    expect(text).toContain('You wrote')
    expect(text).toContain('Build the site')
    expect(text).toContain('Gave a step to Claude Code')
    expect(text).toContain("Not started — Claude Code's quota is used up")
    expect(text).toContain('Waited for the quota')
    expect(text).toContain('Waiting until 14:00')
    expect(text).toContain('1,200 in · 300 out · $0.0123')
    // The placeholder name is never shown as stored.
    expect(text).toContain('Read reports from')
    const buttons = [...host.querySelectorAll('button')]
    // A placeholder name of an agent that still exists reads as its name now.
    expect(buttons.some((b) => b.textContent === 'Claude Code')).toBe(true)
    const report = buttons.find((b) => b.textContent === 'former employee')!
    expect(report).toBeTruthy()
    report.click()
    expect(onJumpTo).toHaveBeenCalledWith('m9')
  })

  it('a round with no record shows that it is not available', async () => {
    getPmRound.mockRejectedValue(
      Object.assign(new Error('Not found'), { status: 404 })
    )
    const { host } = await mount()
    await open(host)
    expect(host.textContent).toContain(
      'The record of this round is not available.'
    )
  })
})
