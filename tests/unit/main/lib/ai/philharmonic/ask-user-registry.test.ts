import { askUserRegistry } from '@main/lib/ai/philharmonic/ask-user-registry'
// src/main/lib/ai/philharmonic/ask-user-registry.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.useRealTimers())

const ASK = { question: 'Link the folder?', options: ['Linked', 'Not yet'] }

describe('askUserRegistry', () => {
  it('reserves an answer until saved, rejects concurrent responses and then promotes the next question', async () => {
    let saved!: () => void
    const first = askUserRegistry.wait('reserve', ASK)
    const second = askUserRegistry.wait('reserve', ASK)
    const questionId = askUserRegistry.question('reserve')!.questionId
    const persist = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          saved = resolve
        })
    )
    const answering = askUserRegistry.answer(
      'reserve',
      'first',
      questionId,
      persist
    )
    const duplicatePersist = vi.fn()
    await expect(
      askUserRegistry.answer(
        'reserve',
        'duplicate',
        undefined,
        duplicatePersist
      )
    ).resolves.toBe(false)
    expect(duplicatePersist).not.toHaveBeenCalled()
    expect(askUserRegistry.question('reserve')!.questionId).toBe(questionId)
    saved()
    await expect(answering).resolves.toBe(true)
    await expect(first).resolves.toBe('first')
    await expect(
      askUserRegistry.answer('reserve', 'stale', questionId, duplicatePersist)
    ).resolves.toBe(false)
    askUserRegistry.resolve('reserve', 'next')
    await expect(second).resolves.toBe('next')
  })

  it('allows retry after failed persistence and never accepts an answer after cancellation', async () => {
    const pending = askUserRegistry.wait('save-error', ASK)
    const id = askUserRegistry.question('save-error')!.questionId
    await expect(
      askUserRegistry.answer('save-error', 'x', id, async () => {
        throw new Error('db offline')
      })
    ).rejects.toThrow('db offline')
    askUserRegistry.cancel('save-error')
    await expect(pending).resolves.toContain('cancelled')
    await expect(
      askUserRegistry.answer('save-error', 'x', id, vi.fn())
    ).resolves.toBe(false)
  })

  it('does not activate another question from the same aborted round', async () => {
    const controller = new AbortController()
    const successor = vi.fn()
    const first = askUserRegistry.wait('round-abort', ASK, {
      signal: controller.signal
    })
    const second = askUserRegistry.wait('round-abort', ASK, {
      signal: controller.signal,
      onActive: successor
    })
    controller.abort()
    await expect(first).resolves.toContain('cancelled')
    await expect(second).resolves.toContain('cancelled')
    expect(successor).not.toHaveBeenCalled()
  })
  it('resolves a waiting question with the provided answer', async () => {
    const pending = askUserRegistry.wait('c1', ASK)
    expect(askUserRegistry.has('c1')).toBe(true)
    askUserRegistry.resolve('c1', 'the answer')
    await expect(pending).resolves.toBe('the answer')
    expect(askUserRegistry.has('c1')).toBe(false)
  })

  it('keeps the question while it waits, and drops it once answered', () => {
    void askUserRegistry.wait('c2', ASK)
    expect(askUserRegistry.question('c2')).toMatchObject(ASK)
    askUserRegistry.resolve('c2', 'Linked')
    expect(askUserRegistry.question('c2')).toBeNull()
  })

  it('resolve on unknown conversation is a no-op', () => {
    expect(() => askUserRegistry.resolve('nope', 'x')).not.toThrow()
  })

  it('queues independent questions and only presents the head, rejecting a stale answer id', async () => {
    const firstActive = vi.fn()
    const secondActive = vi.fn()
    const first = askUserRegistry.wait('fifo', ASK, { onActive: firstActive })
    const firstId = askUserRegistry.question('fifo')!.questionId
    const second = askUserRegistry.wait(
      'fifo',
      { question: 'Ship it?', options: [] },
      { onActive: secondActive }
    )
    expect(firstActive).toHaveBeenCalledTimes(1)
    expect(secondActive).not.toHaveBeenCalled()
    expect(askUserRegistry.question('fifo')!.question).toBe(ASK.question)
    expect(askUserRegistry.resolve('fifo', 'Linked', firstId)).toBe(true)
    await expect(first).resolves.toBe('Linked')
    expect(secondActive).toHaveBeenCalledTimes(1)
    expect(askUserRegistry.question('fifo')!.question).toBe('Ship it?')
    expect(askUserRegistry.resolve('fifo', 'Duplicate answer', firstId)).toBe(
      false
    )
    askUserRegistry.resolve('fifo', 'Yes')
    await expect(second).resolves.toBe('Yes')
    expect(askUserRegistry.has('fifo')).toBe(false)
  })

  it('cancels active and queued questions without showing a cancelled successor', async () => {
    const successor = vi.fn()
    const first = askUserRegistry.wait('cancel', ASK)
    const second = askUserRegistry.wait('cancel', ASK, { onActive: successor })
    askUserRegistry.cancel('cancel')
    await expect(first).resolves.toContain('cancelled')
    await expect(second).resolves.toContain('cancelled')
    expect(successor).not.toHaveBeenCalled()
    expect(askUserRegistry.question('cancel')).toBeNull()
  })

  it('removes an aborted queued question without disturbing the current one', async () => {
    const first = askUserRegistry.wait('abort', ASK)
    const controller = new AbortController()
    const second = askUserRegistry.wait('abort', ASK, {
      signal: controller.signal
    })
    controller.abort()
    await expect(second).resolves.toContain('cancelled')
    expect(askUserRegistry.has('abort')).toBe(true)
    askUserRegistry.resolve('abort', 'done')
    await expect(first).resolves.toBe('done')
    const alreadyAborted = askUserRegistry.wait('abort', ASK, {
      signal: controller.signal
    })
    await expect(alreadyAborted).resolves.toContain('cancelled')
    expect(askUserRegistry.has('abort')).toBe(false)
  })

  it('expires only the visible question and starts the successor timeout when shown', async () => {
    vi.useFakeTimers()
    const first = askUserRegistry.wait('timeout', ASK, { timeoutMs: 100 })
    const second = askUserRegistry.wait(
      'timeout',
      { question: 'Next', options: [] },
      { timeoutMs: 100 }
    )
    await vi.advanceTimersByTimeAsync(100)
    await expect(first).resolves.toContain('timed out')
    expect(askUserRegistry.question('timeout')!.question).toBe('Next')
    await vi.advanceTimersByTimeAsync(99)
    expect(askUserRegistry.has('timeout')).toBe(true)
    askUserRegistry.resolve('timeout', 'answer')
    await expect(second).resolves.toBe('answer')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removes a question if presenting it fails', async () => {
    const pending = askUserRegistry.wait('emit-error', ASK, {
      onActive: () => {
        throw new Error('stream closed')
      }
    })
    await expect(pending).resolves.toContain('cancelled')
    expect(askUserRegistry.has('emit-error')).toBe(false)
  })
})
