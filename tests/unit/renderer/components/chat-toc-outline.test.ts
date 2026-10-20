// @vitest-environment happy-dom
// The rail names each user message by its question: a Health context, a
// quote and an answer's fence are not the question, and never shown raw.
import {
  composeConfirmAnswer,
  type AnswerLabels
} from '@actovia/shared/utils/interactive-answer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const { outlineText } = await import('@/components/chat/chat-toc')

const LABELS: AnswerLabels = {
  other: 'Other',
  addition: 'Also',
  note: 'Note',
  approved: 'Approved',
  rejected: 'Rejected'
}

describe('outlineText', () => {
  it('names an answer by its lines as plain text, without the fence or bold markers', () => {
    const answer = composeConfirmAnswer(
      { title: 'Send the report?' },
      'run-1',
      true,
      '',
      LABELS
    )
    const text = outlineText(answer)
    expect(text).toBe('Send the report? Approved')
    expect(text).not.toContain('actovia-answer')
    expect(text).not.toContain('**')
  })

  it("falls back to the block's title when an answer has no lines", () => {
    const fenceOnly =
      '```actovia-answer\n{"block":"ask","ref":"run-1","title":"A few details first"}\n```'
    expect(outlineText(fenceOnly)).toBe('A few details first')
  })

  it('leaves an ordinary message as it is', () => {
    expect(outlineText('How tall is K2?')).toBe('How tall is K2?')
  })
})
