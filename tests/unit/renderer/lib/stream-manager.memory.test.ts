// @vitest-environment happy-dom
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { ChatSseEvent } from '@actovia/shared/types/chat'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { memoryKeys } from '@/hooks/use-memory'
import { queryClient } from '@/lib/query-client'

// Real i18n/sileo would need boot work this file has no use for — every
// assertion here is about `queryClient`'s cache, not a toast.
vi.mock('@/lib/i18n', () => ({ i18n: { t: (key: string) => key } }))
vi.mock('sileo', () => ({
  sileo: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}))

const { startStream } = await import('@/lib/stream-manager')

// Encodes a sequence of app-level SSE events as one `data: ...\n\n` frame
// per chunk and stands in for `fetch`'s streamed Response.
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

const noopSubscriber = {
  onMessages: vi.fn(),
  onStatus: vi.fn(),
  onTitle: vi.fn(),
  onError: vi.fn(),
  onFinish: vi.fn()
}

async function runStream(chatId: string, events: ChatSseEvent[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(events)))
  const finished = new Promise<void>((resolve) => {
    startStream({
      chatId,
      chatTitle: 'Title',
      api: '/api/v1/chat',
      body: {},
      subscriber: { ...noopSubscriber, onFinish: () => resolve() },
      initialMessages: []
    })
  })
  await finished
}

afterEach(() => {
  queryClient.clear()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('stream-manager: memories_used', () => {
  it('writes the run straight into memoryKeys.usage(chatId), alongside any run already cached', async () => {
    queryClient.setQueryData(memoryKeys.usage('chat-1'), {
      'run-old': [{ id: 'm0', key: 'Old entry', section: 'topic' }]
    })

    await runStream('chat-1', [
      {
        type: 'memories_used',
        runId: 'run-new',
        memories: [{ id: 'm1', key: 'Work setup', section: 'profile' }]
      }
    ])

    expect(queryClient.getQueryData(memoryKeys.usage('chat-1'))).toEqual({
      'run-old': [{ id: 'm0', key: 'Old entry', section: 'topic' }],
      'run-new': [{ id: 'm1', key: 'Work setup', section: 'profile' }]
    })
  })

  it("keys the cache by the stream's own chatId, not by anything in the event", async () => {
    await runStream('chat-2', [
      {
        type: 'memories_used',
        runId: 'run-1',
        memories: [{ id: 'm1', key: 'Work setup', section: 'profile' }]
      }
    ])

    expect(queryClient.getQueryData(memoryKeys.usage('chat-2'))).toEqual({
      'run-1': [{ id: 'm1', key: 'Work setup', section: 'profile' }]
    })
    expect(queryClient.getQueryData(memoryKeys.usage('chat-1'))).toBeUndefined()
  })
})

describe('stream-manager: tool_call_end', () => {
  it('an update_memory tool_call_end invalidates memoryKeys.all', async () => {
    queryClient.setQueryData(memoryKeys.list, [])
    queryClient.setQueryData(memoryKeys.usage('chat-1'), {})

    await runStream('chat-1', [
      {
        type: 'tool_call_end',
        toolCallId: 'call-1',
        toolName: TOOL_NAMES.updateMemory,
        isError: false
      }
    ])

    expect(queryClient.getQueryState(memoryKeys.list)?.isInvalidated).toBe(true)
    expect(
      queryClient.getQueryState(memoryKeys.usage('chat-1'))?.isInvalidated
    ).toBe(true)
  })

  it('an update_memory tool call that errored still invalidates — the strip shows the failed state either way', async () => {
    queryClient.setQueryData(memoryKeys.list, [])

    await runStream('chat-1', [
      {
        type: 'tool_call_end',
        toolCallId: 'call-1',
        toolName: TOOL_NAMES.updateMemory,
        isError: true
      }
    ])

    expect(queryClient.getQueryState(memoryKeys.list)?.isInvalidated).toBe(true)
  })

  it('a tool_call_end for any other tool leaves the memory queries alone', async () => {
    queryClient.setQueryData(memoryKeys.list, [])

    await runStream('chat-1', [
      {
        type: 'tool_call_end',
        toolCallId: 'call-1',
        toolName: TOOL_NAMES.webSearch,
        isError: false
      }
    ])

    expect(queryClient.getQueryState(memoryKeys.list)?.isInvalidated).toBe(
      false
    )
  })
})
