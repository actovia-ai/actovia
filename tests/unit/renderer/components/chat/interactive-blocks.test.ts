// @vitest-environment happy-dom
// A turn's questionnaire or confirmation is drawn as a control and answers
// through the chat's send; once the chat holds the answer the block is frozen.
// Anything else — invalid, a second block, a fence still open, a block
// outside a turn — stays the code block it is.
import type {
  ChatMessage,
  ChatStatus,
  SendMessageOptions,
  TurnBlock
} from '@actovia/shared/types/chat'
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

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key
const i18n = { resolvedLanguage: 'en', language: 'en' }
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n }) }))

const { default: Markdown } = await import('@/components/markdown/markdown')
const {
  InteractiveProvider,
  InteractiveTurnContext,
  TurnTextAboveContext,
  answersIn,
  turnTextsAbove,
  useInteractiveChat,
  useInteractiveTurn
} = await import('@/components/chat/interactive/interactive-context')

// What `answerLabels(t)` gives with `t` returning its key.
const LABELS: AnswerLabels = {
  other: 'interactive.answer.other',
  addition: 'interactive.answer.addition',
  note: 'interactive.answer.note',
  approved: 'interactive.approved',
  rejected: 'interactive.rejected'
}
const ASK = {
  title: 'Where does it itch?',
  questions: [
    {
      id: 'where',
      text: 'Where?',
      type: 'single',
      options: ['Legs', 'Arms'],
      other: true
    }
  ]
}
const CONFIRM = { title: 'Send the report?', details: 'To **Ann**, today.' }
const ASK_BLOCK = askBlockSchema.parse(ASK)
const CONFIRM_BLOCK = confirmBlockSchema.parse(CONFIRM)

const fence = (language: string, value: unknown) =>
  `\`\`\`${language}\n${typeof value === 'string' ? value : JSON.stringify(value)}\n\`\`\``
const userMessage = (id: string, text: string) =>
  ({ id, runId: id, role: 'user', content: text, timestamp: 1 }) as ChatMessage

/**
 * A turn's reply as `AssistantTurnSegment` draws it: each text block's
 * Markdown, under the turn's block and the text above it. `body` alone is a
 * reply of one text block.
 */
function Turn({
  body,
  texts = [body],
  answerable
}: {
  body: string
  texts?: string[]
  answerable?: boolean
}) {
  const turn = useInteractiveTurn('run-1', body, answerable)
  const above = turnTextsAbove(
    texts.map((text, i) => ({ kind: 'text', key: `t${i}`, text }) as TurnBlock)
  )
  return createElement(
    InteractiveTurnContext.Provider,
    { value: turn },
    ...texts.map((text, i) =>
      createElement(
        TurnTextAboveContext.Provider,
        // eslint-disable-next-line react/no-array-index-key -- a fixed list
        { key: i, value: above[i] },
        createElement(Markdown, { src: text })
      )
    )
  )
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const send = vi.fn(async (_opts: SendMessageOptions) => {})

beforeEach(() => {
  send.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const show = (
  body: string,
  {
    messages = [],
    status = 'idle',
    answerable,
    texts
  }: {
    messages?: ChatMessage[]
    status?: ChatStatus
    answerable?: boolean
    /** The turn's text blocks, when it has more than one (`body` is them joined). */
    texts?: string[]
  } = {},
  inTurn = true
) =>
  act(async () =>
    root.render(
      createElement(
        InteractiveProvider,
        { messages, status, send },
        inTurn
          ? createElement(Turn, { body, answerable, texts })
          : createElement(Markdown, { src: body })
      )
    )
  )

const block = () => host.querySelector('[data-interactive]')
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent === label
  )

describe('a questionnaire in a reply', () => {
  it('is drawn in place of its code, and Submit sends the composed answer', async () => {
    await show(`Before I answer:\n\n${fence('actovia-ask', ASK)}`)
    expect(block()?.dataset.interactive).toBe('ask')
    expect(block()?.dataset.state).toBe('open')
    expect(host.querySelector('pre')).toBeNull()

    const arms = host.querySelector<HTMLInputElement>('input[value="Arms"]')
    await act(async () => arms?.click())
    await act(async () => {
      host
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        )
    })
    expect(send).toHaveBeenCalledWith({
      text: composeAskAnswer(
        ASK_BLOCK,
        'run-1',
        { where: { options: ['Arms'], other: null } },
        '',
        LABELS
      )
    })
  })

  it('is frozen once the chat holds its answer: the picks shown, no Submit', async () => {
    const answer = composeAskAnswer(
      ASK_BLOCK,
      'run-1',
      { where: { options: ['Legs'], other: null } },
      '',
      LABELS
    )
    await show(fence('actovia-ask', ASK), {
      messages: [userMessage('u2', answer)]
    })
    expect(block()?.dataset.state).toBe('answered')
    expect(host.querySelector('button[type="submit"]')).toBeNull()
    // The questionnaire as it was asked: every choice, the pick checked, none
    // taking input.
    const choices = Array.from(
      host.querySelectorAll('[data-slot="questionnaire-choice"]')
    )
    expect(choices.length).toBeGreaterThan(1)
    expect(
      choices
        .filter((n) => n.dataset.checked !== undefined)
        .map((n) => n.textContent)
    ).toEqual(['Legs'])
    expect(host.querySelector('input')).toBeNull()
    expect(
      choices.every((n) => n.getAttribute('aria-disabled') === 'true')
    ).toBe(true)
    expect(host.textContent).toContain('interactive.answered')
  })

  it('names its picks for a screen reader once answered', async () => {
    const answer = composeAskAnswer(
      ASK_BLOCK,
      'run-1',
      { where: { options: ['Legs'], other: null } },
      '',
      LABELS
    )
    await show(fence('actovia-ask', ASK), {
      messages: [userMessage('u2', answer)]
    })
    const group = block()
    expect(group?.getAttribute('role')).toBe('group')
    expect(group?.getAttribute('aria-label')).toBe(
      'Where does it itch? — interactive.answered. Where? Legs'
    )
  })

  it('moves focus to the answered summary after Submit (the form is gone)', async () => {
    const body = fence('actovia-ask', ASK)
    await show(body)
    const arms = host.querySelector<HTMLInputElement>('input[value="Arms"]')
    await act(async () => arms?.click())
    await act(async () => {
      host
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        )
    })
    const sent = send.mock.calls[0]?.[0].text ?? ''
    // The chat now holds the answer: the block freezes in place.
    await show(body, { messages: [userMessage('u2', sent)] })
    expect(block()?.dataset.state).toBe('answered')
    expect(document.activeElement).toBe(block())
  })

  it('does not take focus when it is drawn answered (a chat opened from history)', async () => {
    const answer = composeAskAnswer(
      ASK_BLOCK,
      'run-1',
      { where: { options: ['Legs'], other: null } },
      '',
      LABELS
    )
    await show(fence('actovia-ask', ASK), {
      messages: [userMessage('u2', answer)]
    })
    expect(document.activeElement).not.toBe(block())
  })

  describe('while a reply streams (no answer can be sent)', () => {
    it('Skip on the last question is disabled and skips nothing', async () => {
      await show(fence('actovia-ask', ASK), { status: 'streaming' })
      const skip = button('interactive.skip')
      expect(skip?.disabled).toBe(true)
      await act(async () => skip?.click())
      expect(host.querySelector('fieldset')?.dataset.status).not.toBe('skipped')
      expect(send).not.toHaveBeenCalled()
    })

    it('Cmd+Enter does not submit the form', async () => {
      await show(fence('actovia-ask', ASK), { status: 'streaming' })
      const arms = host.querySelector<HTMLInputElement>('input[value="Arms"]')
      await act(async () => arms?.click())
      const submits = vi.fn()
      host.querySelector('form')?.addEventListener('submit', submits)
      await act(async () => {
        arms?.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            metaKey: true,
            bubbles: true,
            cancelable: true
          })
        )
        await Promise.resolve()
      })
      expect(submits).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
    })

    it('Cmd+Enter submits once the reply is done', async () => {
      await show(fence('actovia-ask', ASK))
      const arms = host.querySelector<HTMLInputElement>('input[value="Arms"]')
      await act(async () => arms?.click())
      await act(async () => {
        arms?.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            metaKey: true,
            bubbles: true,
            cancelable: true
          })
        )
        await Promise.resolve()
      })
      expect(send).toHaveBeenCalledTimes(1)
    })
  })
})

describe('a confirmation in a reply', () => {
  it('Approve sends the decision and the note', async () => {
    await show(fence('actovia-confirm', CONFIRM))
    expect(block()?.dataset.state).toBe('open')
    expect(host.querySelector('strong')?.textContent).toBe('Ann')

    const note = host.querySelector('textarea')
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set
    await act(async () => {
      if (!note || !setValue) return
      setValue.call(note, 'cc Bob')
      note.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('interactive.approve')?.click())
    expect(send).toHaveBeenCalledWith({
      text: composeConfirmAnswer(CONFIRM_BLOCK, 'run-1', true, 'cc Bob', LABELS)
    })
  })

  it('does not load a remote picture in its details before a tap', async () => {
    const src = 'https://tracker.example/p.png?d=secret'
    await show(
      fence('actovia-confirm', { ...CONFIRM, details: `See ![x](${src})` })
    )
    expect(block()?.dataset.interactive).toBe('confirm')
    expect(host.querySelector(`img[src="${src}"]`)).toBeNull()
  })

  it('moves focus to the decision after Approve (the buttons are gone)', async () => {
    const body = fence('actovia-confirm', CONFIRM)
    await show(body)
    await act(async () => button('interactive.approve')?.click())
    const sent = send.mock.calls[0]?.[0].text ?? ''
    await show(body, { messages: [userMessage('u2', sent)] })
    expect(block()?.dataset.state).toBe('approve')
    expect(document.activeElement?.textContent).toBe('interactive.approved')
  })

  it('sends nothing while a reply streams', async () => {
    await show(fence('actovia-confirm', CONFIRM), { status: 'streaming' })
    expect(button('interactive.approve')?.disabled).toBe(true)
    expect(button('interactive.reject')?.disabled).toBe(true)
    await act(async () => button('interactive.approve')?.click())
    expect(send).not.toHaveBeenCalled()
  })

  it('sends nothing from an answer still being compared (no answer path)', async () => {
    await show(fence('actovia-confirm', CONFIRM), { answerable: false })
    expect(block()?.dataset.state).toBe('open')
    expect(button('interactive.approve')?.disabled).toBe(true)
    expect(button('interactive.reject')?.disabled).toBe(true)
    await act(async () => button('interactive.approve')?.click())
    expect(send).not.toHaveBeenCalled()
  })

  it('shows the decision once answered, without its buttons', async () => {
    const answer = composeConfirmAnswer(
      CONFIRM_BLOCK,
      'run-1',
      false,
      '',
      LABELS
    )
    await show(fence('actovia-confirm', CONFIRM), {
      messages: [userMessage('u2', answer)]
    })
    expect(block()?.dataset.state).toBe('reject')
    expect(host.textContent).toContain('interactive.rejected')
    expect(button('interactive.approve')).toBeUndefined()
  })
})

describe('what stays code', () => {
  it('a block over the limits', async () => {
    await show(fence('actovia-ask', { ...ASK, questions: [] }))
    expect(block()).toBeNull()
    expect(host.querySelector('pre')).not.toBeNull()
  })

  it('a second block in the reply', async () => {
    await show(
      `${fence('actovia-confirm', CONFIRM)}\n\n${fence('actovia-ask', ASK)}`
    )
    expect(host.querySelectorAll('[data-interactive]')).toHaveLength(1)
    expect(block()?.dataset.interactive).toBe('confirm')
    expect(host.querySelectorAll('pre')).toHaveLength(1)
  })

  it('a second block with the same text as the first', async () => {
    await show(`${fence('actovia-ask', ASK)}\n\n${fence('actovia-ask', ASK)}`)
    expect(host.querySelectorAll('[data-interactive]')).toHaveLength(1)
    expect(host.querySelectorAll('pre')).toHaveLength(1)
    // The first one is the control, the second its code.
    expect(
      host
        .querySelector('[data-interactive]')
        ?.compareDocumentPosition(host.querySelector('pre')!)
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('a tilde fence, and a fence whose info string says more than the name', async () => {
    const json = JSON.stringify(ASK)
    for (const opening of ['~~~actovia-ask', '```actovia-ask x']) {
      const close = opening.startsWith('~') ? '~~~' : '```'
      await show(`${opening}\n${json}\n${close}`)
      expect(block()).toBeNull()
      expect(host.querySelector('pre')).not.toBeNull()
    }
  })

  it('the same text in a tilde fence above the real block', async () => {
    await show(
      `~~~actovia-ask\n${JSON.stringify(ASK)}\n~~~\n\n${fence('actovia-ask', ASK)}`
    )
    expect(host.querySelectorAll('[data-interactive]')).toHaveLength(1)
    const pre = host.querySelector('pre')
    expect(pre).not.toBeNull()
    // The code is the tilde fence, above the control.
    expect(
      pre?.compareDocumentPosition(host.querySelector('[data-interactive]')!)
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('a second block with the same text, in a later text block of the run', async () => {
    const first = `Before I answer:\n\n${fence('actovia-ask', ASK)}`
    const second = `After a tool call:\n\n${fence('actovia-ask', ASK)}`
    await show(`${first}\n\n${second}`, { texts: [first, second] })
    expect(host.querySelectorAll('[data-interactive]')).toHaveLength(1)
    expect(host.querySelectorAll('pre')).toHaveLength(1)
    expect(
      host
        .querySelector('[data-interactive]')
        ?.compareDocumentPosition(host.querySelector('pre')!)
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('a fence still being written: code, not a form, frame after frame', async () => {
    const json = JSON.stringify(ASK)
    for (const end of [12, 40, json.length]) {
      const partial = `Before I answer:\n\n\`\`\`actovia-ask\n${json.slice(0, end)}`
      await show(partial)
      expect(block()).toBeNull()
      expect(host.querySelector('form')).toBeNull()
      expect(host.querySelector('pre')).not.toBeNull()
    }
  })

  it('a block outside a turn (a user message, a tool description)', async () => {
    await show(fence('actovia-ask', ASK), {}, false)
    expect(block()).toBeNull()
    expect(host.querySelector('pre')).not.toBeNull()
  })
})

describe('a reply written with CRLF line ends', () => {
  it('still draws its block', async () => {
    const crlf = `Before I answer:\n\n${fence('actovia-confirm', {
      ...CONFIRM,
      details: 'line one'
    })}\n`.replaceAll('\n', '\r\n')
    await show(crlf)
    expect(block()?.dataset.interactive).toBe('confirm')
    expect(host.querySelector('pre')).toBeNull()
  })
})

describe('the chat around the blocks', () => {
  it('stays the same while a reply streams and no answer arrives', async () => {
    const seen: unknown[] = []
    function Probe() {
      seen.push(useInteractiveChat())
      return null
    }
    const hello = userMessage('u1', 'hello')
    const frame = (text: string) =>
      ({
        id: 'a1',
        runId: 'u1',
        role: 'assistant',
        content: [{ type: 'text', text }],
        timestamp: 1
      }) as unknown as ChatMessage
    for (const text of ['Hel', 'Hello there']) {
      await act(async () =>
        root.render(
          createElement(
            InteractiveProvider,
            { messages: [hello, frame(text)], status: 'idle', send },
            createElement(Probe)
          )
        )
      )
    }
    expect(seen).toHaveLength(2)
    expect(seen[1]).toBe(seen[0])
  })
})

describe('answersIn', () => {
  it('maps each answer to the run it names; other messages are not answers', () => {
    const answer = composeConfirmAnswer(
      CONFIRM_BLOCK,
      'run-1',
      true,
      '',
      LABELS
    )
    const answers = answersIn([
      userMessage('u1', 'hello'),
      userMessage('u2', answer),
      {
        id: 'a1',
        runId: 'u1',
        role: 'assistant',
        content: [{ type: 'text', text: answer }],
        timestamp: 1
      } as unknown as ChatMessage
    ])
    expect([...answers.keys()]).toEqual(['run-1'])
    expect(answers.get('run-1')?.head.decision).toBe('approve')
  })
})
