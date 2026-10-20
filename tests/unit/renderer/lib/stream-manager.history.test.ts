// @vitest-environment happy-dom
import type { ChatSseEvent } from '@actovia/shared/types/chat'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { historyKeys } from '@/hooks/use-chat-history'
import { queryClient } from '@/lib/query-client'

// Real i18n/sileo would need boot work this file has no use for — every
// assertion here is about `queryClient`'s cache, not a toast.
vi.mock('@/lib/i18n', () => ({ i18n: { t: (key: string) => key } }))
vi.mock('sileo', () => ({
  sileo: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}))

const { isStreaming, startStream, unsubscribe } =
  await import('@/lib/stream-manager')

function sseResponse(events: ChatSseEvent[]) {
  const encoder = new TextEncoder()
  const chunks = events.map((e) =>
    encoder.encode(`data: ${JSON.stringify(e)}\n\n`)
  )
  let i = 0
  const reader = {
    read: vi.fn(async () => {
      if (i < chunks.length) return { done: false, value: chunks[i++] }
      return { done: true, value: undefined }
    }),
    cancel: vi.fn(async () => {})
  }
  return {
    ok: true,
    body: { getReader: () => reader },
    headers: { get: () => null },
    json: async () => ({})
  } as unknown as Response
}

const subscriber = () => ({
  onMessages: vi.fn(),
  onStatus: vi.fn(),
  onTitle: vi.fn(),
  onError: vi.fn(),
  onFinish: vi.fn()
})

/**
 * A run whose chat page is gone before it ends — the user opened another
 * chat — so nothing but the stream manager is left to refresh the list.
 */
async function runUnwatched(chatId: string, response: Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(response))
  startStream({
    chatId,
    chatTitle: 'New chat',
    api: '/api/v1/chat',
    body: {},
    subscriber: subscriber(),
    initialMessages: []
  })
  unsubscribe(chatId)
  await vi.waitFor(() => expect(isStreaming(chatId)).toBe(false))
}

const listInvalidated = () =>
  queryClient.getQueryState(historyKeys.all)?.isInvalidated

afterEach(() => {
  queryClient.clear()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('stream-manager: the chat list', () => {
  it('is refreshed when a run ends with no chat page watching it', async () => {
    queryClient.setQueryData(historyKeys.all, [])

    await runUnwatched('chat-1', Promise.resolve(sseResponse([])))

    expect(listInvalidated()).toBe(true)
  })

  it('is refreshed when a title arrives with no chat page watching it', async () => {
    queryClient.setQueryData(historyKeys.all, [])
    let invalidatedAtTitle: boolean | undefined
    const response = sseResponse([{ type: 'title', title: 'Weather in Oslo' }])
    const { read } = response.body!.getReader() as unknown as {
      read: ReturnType<typeof vi.fn>
    }
    // The second read is the end of the stream: by then the title is handled.
    read.mockImplementationOnce(read.getMockImplementation()!)
    read.mockImplementationOnce(async () => {
      invalidatedAtTitle = listInvalidated()
      return { done: true, value: undefined }
    })

    await runUnwatched('chat-1', Promise.resolve(response))

    expect(invalidatedAtTitle).toBe(true)
  })

  it('is refreshed when the run fails: the chat was saved before it started', async () => {
    queryClient.setQueryData(historyKeys.all, [])

    await runUnwatched(
      'chat-1',
      Promise.resolve(sseResponse([{ type: 'error', error: 'provider down' }]))
    )

    expect(listInvalidated()).toBe(true)
  })

  it("leaves an open chat's messages alone", async () => {
    queryClient.setQueryData(historyKeys.all, [])
    queryClient.setQueryData(historyKeys.detail('chat-1'), [])

    await runUnwatched('chat-1', Promise.resolve(sseResponse([])))

    expect(
      queryClient.getQueryState(historyKeys.detail('chat-1'))?.isInvalidated
    ).toBe(false)
  })
})
