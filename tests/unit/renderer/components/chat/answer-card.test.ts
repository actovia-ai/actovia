// @vitest-environment happy-dom
// A message that answers a questionnaire or a confirmation is drawn as a card:
// the block's title, then the answers, quieter — never the fence it travels
// in. A malformed answer fence is an ordinary message.
import {
  askBlockSchema,
  confirmBlockSchema
} from '@actovia/shared/types/interactive'
import {
  composeAskAnswer,
  composeConfirmAnswer,
  type AnswerLabels
} from '@actovia/shared/utils/interactive-answer'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string) => key
const i18n = { resolvedLanguage: 'en', language: 'en' }
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n }) }))

const { UserBubble } = await import('@/components/chat/user-bubble')

const EN: AnswerLabels = {
  other: 'Other',
  addition: 'Also',
  note: 'Note',
  approved: 'Approved',
  rejected: 'Rejected'
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const show = (text: string) =>
  act(async () => root.render(createElement(UserBubble, { text })))
const title = () =>
  host.querySelector('[data-slot="answer-title"]')?.textContent

describe('an answer in the user bubble', () => {
  it("draws a questionnaire's answer as its title over the answers, without the fence", async () => {
    const block = askBlockSchema.parse({
      title: 'A few details first',
      questions: [
        {
          id: 'where',
          text: 'Where?',
          type: 'single',
          options: ['Legs', 'Arms']
        }
      ]
    })
    await show(
      composeAskAnswer(
        block,
        'run-1',
        { where: { options: ['Legs'], other: null } },
        'Unscented lotion',
        EN
      )
    )
    expect(host.querySelector('[data-answer="ask"]')).not.toBeNull()
    expect(title()).toBe('A few details first')
    expect(
      Array.from(host.querySelectorAll('strong')).map((s) => s.textContent)
    ).toEqual(['Where?', 'Also:'])
    expect(host.textContent).toContain('Legs')
    expect(host.textContent).not.toContain('actovia-answer')
    expect(host.querySelector('pre')).toBeNull()
  })

  it("draws a confirmation's answer with its decision", async () => {
    const block = confirmBlockSchema.parse({ title: 'Send the report?' })
    await show(composeConfirmAnswer(block, 'run-1', false, '', EN))
    expect(host.querySelector('[data-answer="confirm"]')).not.toBeNull()
    expect(title()).toBe('Send the report?')
    expect(host.textContent).toContain('Rejected')
  })

  it('an answer without a title reads "Your answer"', async () => {
    await show('```actovia-answer\n{"block":"ask","ref":"r"}\n```\n\n**Q** A')
    expect(title()).toBe('interactive.answer.title')
  })

  it('a malformed answer fence is an ordinary message', async () => {
    await show('```actovia-answer\n{oops}\n```\n\nhello')
    expect(host.querySelector('[data-answer]')).toBeNull()
    expect(title()).toBeUndefined()
    expect(host.querySelector('pre')).not.toBeNull()
    expect(host.textContent).toContain('hello')
  })
})
