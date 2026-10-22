import { askUserRegistry } from '@main/lib/ai/philharmonic/ask-user-registry'
// src/main/lib/ai/philharmonic/ask-user-registry.test.ts
import { describe, expect, it } from 'vitest'

const ASK = { question: 'Link the folder?', options: ['Linked', 'Not yet'] }

describe('askUserRegistry', () => {
  it('resolves a waiting question with the provided answer', async () => {
    const pending = askUserRegistry.wait('c1', ASK)
    expect(askUserRegistry.has('c1')).toBe(true)
    askUserRegistry.resolve('c1', 'the answer')
    await expect(pending).resolves.toBe('the answer')
    expect(askUserRegistry.has('c1')).toBe(false)
  })

  it('keeps the question while it waits, and drops it once answered', () => {
    void askUserRegistry.wait('c2', ASK)
    expect(askUserRegistry.question('c2')).toEqual(ASK)
    askUserRegistry.resolve('c2', 'Linked')
    expect(askUserRegistry.question('c2')).toBeNull()
  })

  it('resolve on unknown conversation is a no-op', () => {
    expect(() => askUserRegistry.resolve('nope', 'x')).not.toThrow()
  })
})
