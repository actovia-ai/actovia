// @vitest-environment happy-dom
import { readFileSync } from 'fs'
import { join } from 'path'

import type { PmRoundEventDto } from '@actovia/shared/types/pm-round'
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
const { TEST_IDS } = await import('@actovia/shared/constants/test-ids')

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
    args: {
      employeeId: 'a1',
      instructions: 'Build the landing page with the hero and the pricing table'
    }
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
    args: { stepId: 's1', employeeId: 'a1', reason: 'the week is used up' }
  }),
  ev('tool_result', {
    toolCallId: 't3',
    name: 'waitForQuota',
    text: 'Step parked. You will be woken at Tue 07:00. End your turn now with one line for the owner saying what waits and why.',
    isError: false
  }),
  ev('tool_call', {
    toolCallId: 't4',
    name: 'waitForQuota',
    args: { stepId: 's2', employeeId: 'a2', reason: 'just in case' }
  }),
  ev('tool_result', {
    toolCallId: 't4',
    name: 'waitForQuota',
    text: 'Refused: nothing blocks that employee right now — delegate the step instead.',
    isError: false
  }),
  ev('tool_call', {
    toolCallId: 't5',
    name: 'delegateTask',
    args: { employeeId: 'a2', instructions: 'Write the copy' }
  }),
  ev('tool_result', {
    toolCallId: 't5',
    name: 'delegateTask',
    text: 'Written.',
    isError: false
  }),
  ev('tool_call', {
    toolCallId: 't6',
    name: 'updatePlanStep',
    args: { stepId: 's1', status: 'done' }
  }),
  ev('tool_result', {
    toolCallId: 't6',
    name: 'updatePlanStep',
    text: '{"stepId":"s1"}',
    isError: false
  }),
  ev('tool_call', {
    toolCallId: 't7',
    name: 'createPlan',
    args: { steps: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] }
  }),
  ev('usage', {
    inputTokens: 1200,
    outputTokens: 300,
    cacheReadTokens: 0,
    costUsd: 0.0123
  })
]

const agents: Record<
  string,
  { name: string; runtime: string; model: string | null }
> = {
  a1: { name: 'Ada', runtime: 'claude-code', model: 'sonnet' },
  a2: { name: 'Bea', runtime: 'actovia', model: 'gpt-5' },
  a3: { name: 'Cy', runtime: 'codex', model: null }
}

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
        agentOf: (id: string) => agents[id],
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
    // A CLI employee reads with its CLI and model; an Actovia one by name.
    expect(text).toContain('Gave a step to Ada · Claude Code · sonnet')
    expect(text).toContain('Gave a step to Bea')
    expect(text).not.toContain('Bea · ')
    expect(text).toContain("Not started — Ada's quota is used up")
    expect(text).toContain(
      "Waited for Ada's quota — the week is used up · woken at Tue 07:00"
    )
    expect(text).toContain(
      "Didn't wait — nothing blocks that employee right now — delegate the step instead."
    )
    expect(text).not.toContain("Waited for Bea's quota")
    expect(text).toContain('Marked a step done')
    expect(text).toContain('Planned steps: 3')
    expect(text).toContain('1,200 in · 300 out · $0.0123')
    // The instructions are one clamped line under the delegation.
    const instructions = [...host.querySelectorAll('span')].find(
      (el) =>
        el.textContent ===
        'Build the landing page with the hero and the pricing table'
    )!
    expect(instructions.className).toContain('truncate')
    // The placeholder name is never shown as stored.
    expect(text).toContain('Read reports from')
    const buttons = [...host.querySelectorAll('button')]
    // A placeholder name of an agent that still exists reads as its name now.
    expect(buttons.some((b) => b.textContent === 'Ada')).toBe(true)
    const report = buttons.find((b) => b.textContent === 'former employee')!
    expect(report).toBeTruthy()
    report.click()
    expect(onJumpTo).toHaveBeenCalledWith('m9')
  })

  it('a CLI employee with no model reads as the CLI default; a wait without a wake time has none', async () => {
    getPmRound.mockResolvedValue([
      ev('tool_call', {
        toolCallId: 'x1',
        name: 'delegateTask',
        args: { employeeId: 'a3', instructions: 'Fix it' }
      }),
      ev('tool_call', {
        toolCallId: 'x2',
        name: 'waitForQuota',
        args: { stepId: 's1', employeeId: 'a3', reason: 'limit reached' }
      }),
      ev('tool_result', {
        toolCallId: 'x2',
        name: 'waitForQuota',
        text: 'Step parked.',
        isError: false
      })
    ])
    const { host } = await mount()
    await open(host)
    const text = host.textContent ?? ''
    expect(text).toContain('Gave a step to Cy · Codex · CLI default')
    expect(text).toContain("Waited for Cy's quota — limit reached")
    expect(text).not.toContain('woken at')
  })

  it("a call's details are mounted only once opened, and stay mounted", async () => {
    getPmRound.mockResolvedValue(round)
    const { host } = await mount()
    await open(host)
    const result = 'Written.'
    expect(host.textContent).not.toContain(result)
    const details = [...host.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Arguments and result'
    )
    expect(details.length).toBeGreaterThan(0)
    await act(async () => {
      details.forEach((b) => b.click())
    })
    expect(host.textContent).toContain(result)
    await act(async () => {
      details.forEach((b) => b.click())
    })
    expect(host.textContent).toContain(result)
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
