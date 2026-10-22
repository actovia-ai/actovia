// src/main/lib/server/routes/philharmonic-sse.ts
//
// A client that subscribes to a group mid-round is told what it missed: that
// the PM is running, and the question the PM is waiting on.
import { afterEach, describe, expect, it } from 'vitest'

const { default: philharmonicSse } =
  await import('@main/lib/server/routes/philharmonic-sse')
const { askUserRegistry } =
  await import('@main/lib/ai/philharmonic/ask-user-registry')
const { pmRunRegistry } =
  await import('@main/lib/ai/philharmonic/pm-run-registry')

const ID = 'conv-1'

/** The events the stream opens with: everything enqueued before it is read. */
async function openingEvents(): Promise<{ type: string }[]> {
  const abort = new AbortController()
  const res = await philharmonicSse.request(`/conversations/${ID}/sse`, {
    signal: abort.signal
  })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { value } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined }>((r) =>
        setTimeout(() => r({ value: undefined }), 50)
      )
    ])
    if (!value) break
    text += decoder.decode(value)
  }
  abort.abort()
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)))
}

afterEach(() => {
  askUserRegistry.resolve(ID, '')
  pmRunRegistry.clear(ID)
})

describe('GET /conversations/:id/sse', () => {
  it('opens with nothing when no round is running', async () => {
    expect(await openingEvents()).toEqual([])
  })

  it('replays pm_started and the waiting question to a late subscriber', async () => {
    pmRunRegistry.set(ID, new AbortController())
    void askUserRegistry.wait(ID, {
      question: 'Link the sprout folder?',
      options: ['Linked', 'Answer here']
    })

    expect(await openingEvents()).toEqual([
      { type: 'pm_started', conversationId: ID },
      {
        type: 'ask_user',
        conversationId: ID,
        question: 'Link the sprout folder?',
        options: ['Linked', 'Answer here']
      }
    ])
  })
})
