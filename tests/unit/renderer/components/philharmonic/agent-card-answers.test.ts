// @vitest-environment happy-dom
// tests/unit/renderer/components/philharmonic/agent-card-answers.test.ts — what a question prompt sends
import type { AgentCard, AgentPrompt } from '@actovia/shared/types/agents'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const respondToAgent = vi.hoisted(() => vi.fn())
vi.mock('@/services/agents', () => ({ respondToAgent }))
vi.mock('sileo', () => ({ sileo: { error: vi.fn() } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const { QuestionPrompt } =
  await import('@/components/philharmonic/chat/agent-card-prompts')

const card = (runtime: AgentCard['runtime']) =>
  ({ sessionId: 's1', runtime }) as AgentCard

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  respondToAgent.mockReset()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = (
  runtime: AgentCard['runtime'],
  prompt: Extract<AgentPrompt, { kind: 'question' }>
) =>
  act(() =>
    root.render(createElement(QuestionPrompt, { card: card(runtime), prompt }))
  )

function type(el: HTMLInputElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Clicks, then lets a send settle. */
const click = async (el: Element) => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(() => Promise.resolve())
}
const choice = (label: string) =>
  [...host.querySelectorAll('[data-slot="questionnaire-choice"]')].find((b) =>
    b.textContent?.includes(label)
  )!
const submit = () =>
  [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'agents.card.submit'
  )!
const input = () => host.querySelector('input')!

const where = {
  question: 'Where should it deploy?',
  isOther: true,
  multiSelect: false,
  options: [{ label: 'staging' }, { label: 'production' }]
}

describe('QuestionPrompt answers', () => {
  it('sends a Codex answer under the question’s id, each pick its own answer', async () => {
    respondToAgent.mockResolvedValue({ success: true })
    render('codex', {
      kind: 'question',
      requestId: 'n:7',
      questions: [{ ...where, id: 'env' }]
    })
    await click(choice('staging'))
    type(input(), 'my laptop, too')
    await click(submit())
    expect(respondToAgent).toHaveBeenCalledWith('s1', 'n:7', {
      kind: 'answers',
      answers: { env: ['staging', 'my laptop, too'] }
    })
  })

  it('keeps Claude Code’s answer one string under the question’s text', async () => {
    respondToAgent.mockResolvedValue({ success: true })
    render('claude-code', {
      kind: 'question',
      requestId: 'r1',
      questions: [where]
    })
    await click(choice('staging'))
    type(input(), 'my laptop')
    await click(submit())
    expect(respondToAgent).toHaveBeenCalledWith('s1', 'r1', {
      kind: 'answers',
      answers: { 'Where should it deploy?': 'staging, my laptop' }
    })
  })

  const secret = {
    kind: 'question' as const,
    requestId: 'n:8',
    questions: [
      {
        id: 'tok',
        question: 'Paste the token',
        isSecret: true,
        isOther: false,
        multiSelect: false,
        options: []
      }
    ]
  }

  it('empties a secret once it was sent', async () => {
    respondToAgent.mockResolvedValue({ success: true })
    render('codex', secret)
    type(input(), 's3cret')
    await click(submit())
    expect(respondToAgent).toHaveBeenCalledWith('s1', 'n:8', {
      kind: 'answers',
      answers: { tok: ['s3cret'] }
    })
    expect(input().value).toBe('')
  })

  it('keeps a secret whose send failed, to send again', async () => {
    respondToAgent.mockRejectedValue(new Error('offline'))
    render('codex', secret)
    type(input(), 's3cret')
    await click(submit())
    expect(respondToAgent).toHaveBeenCalledTimes(1)
    expect(input().value).toBe('s3cret')
  })
})
