import { afterEach, describe, expect, it, vi } from 'vitest'

const createConversationMessage = vi.fn(async (_row: unknown) => ({
  id: 'qrow'
}))
const settleQuestionMessage = vi.fn(
  async (
    _c: string,
    _q: string,
    _s: string
  ): Promise<{ id: string } | null> => ({
    id: 'qrow'
  })
)
vi.mock('@main/lib/db/conversation-queries', () => ({
  createConversationMessage: (row: unknown) => createConversationMessage(row),
  settleQuestionMessage: (c: string, q: string, s: string) =>
    settleQuestionMessage(c, q, s)
}))
vi.mock('@main/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

const { askOwner } = await import('@main/lib/ai/philharmonic/group-questions')
const { askUserRegistry } =
  await import('@main/lib/ai/philharmonic/ask-user-registry')

afterEach(() => {
  createConversationMessage.mockClear()
  settleQuestionMessage.mockClear()
})

const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

describe('askOwner', () => {
  it('saves the question in the group before showing it, and settles it with the answer', async () => {
    const emit = vi.fn()
    const asking = askOwner({
      conversationId: 'g1',
      question: 'Which branch?',
      options: ['main', 'dev'],
      emit
    })
    await flush()
    const row = createConversationMessage.mock.calls[0][0] as {
      role: string
      content: string
      parts: Array<{ kind: string; questionId: string; status: string }>
    }
    expect(row).toMatchObject({ role: 'pm', content: 'Which branch?' })
    expect(row.parts[0]).toMatchObject({
      kind: 'question',
      options: ['main', 'dev'],
      status: 'pending'
    })
    const questionId = row.parts[0].questionId
    // The row is announced (clients re-read it), then shown as the question.
    expect(emit.mock.calls.map(([e]) => e.type)).toEqual([
      'message_start',
      'message_end',
      'ask_user'
    ])
    expect(emit.mock.calls[2][0]).toMatchObject({
      questionId,
      messageId: 'qrow'
    })

    askUserRegistry.resolve('g1', 'dev', questionId)
    await expect(asking).resolves.toBe('dev')
    await flush()
    expect(settleQuestionMessage).toHaveBeenCalledWith(
      'g1',
      questionId,
      'answered'
    )
    expect(emit).toHaveBeenLastCalledWith({
      type: 'question_settled',
      conversationId: 'g1',
      messageId: 'qrow',
      questionId,
      status: 'answered'
    })
  })

  it('marks the question cancelled when its round stops', async () => {
    const stop = new AbortController()
    const asking = askOwner({
      conversationId: 'g2',
      question: 'Ship it?',
      options: [],
      signal: stop.signal,
      emit: vi.fn()
    })
    await flush()
    stop.abort()
    await asking
    await flush()
    expect(settleQuestionMessage.mock.calls[0][2]).toBe('cancelled')
  })

  it('still asks when the question cannot be saved, without a message id', async () => {
    createConversationMessage.mockRejectedValueOnce(new Error('db down'))
    const emit = vi.fn()
    const asking = askOwner({
      conversationId: 'g3',
      question: 'Ok?',
      options: [],
      emit
    })
    await flush()
    expect(emit.mock.calls.map(([e]) => e.type)).toEqual(['ask_user'])
    expect(emit.mock.calls[0][0].messageId).toBeUndefined()
    askUserRegistry.resolve('g3', 'ok')
    await asking
    await flush()
    expect(settleQuestionMessage).not.toHaveBeenCalled()
  })
})
