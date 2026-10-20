import type { ChatMessage, ChatSseEvent } from '@actovia/shared/types/chat'
import {
  createSseWriter,
  STREAM_FLUSH_INTERVAL_MS
} from '@main/lib/server/routes/chat-sse'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A real ReadableStream, so cancel/close behave exactly as they do in Hono. */
function openStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    }
  })
  const reader = stream.getReader()
  const decoder = new TextDecoder()

  async function readEvents(): Promise<ChatSseEvent[]> {
    const events: ChatSseEvent[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return events
      for (const frame of decoder.decode(value).split('\n\n')) {
        if (frame.startsWith('data: ')) events.push(JSON.parse(frame.slice(6)))
      }
    }
  }

  return { controller, reader, readEvents }
}

function snapshot(text: string): ChatMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 0
  } as unknown as ChatMessage
}

function textOf(event: ChatSseEvent): string | undefined {
  if (event.type !== 'message_update') return undefined
  const [block] = event.message.content as Array<{ text: string }>
  return block.text
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createSseWriter', () => {
  it('collapses a burst of snapshots into the first one and the latest one', async () => {
    const { controller, readEvents } = openStream()
    const sse = createSseWriter(controller)

    sse.queueUpdate(snapshot('H'))
    sse.queueUpdate(snapshot('He'))
    sse.queueUpdate(snapshot('Hel'))
    sse.queueUpdate(snapshot('Hell'))
    sse.close()

    const events = await readEvents()
    expect(events.map(textOf)).toEqual(['H', 'Hell'])
  })

  it('sends the trailing snapshot on its own once the interval elapses', async () => {
    const { controller, readEvents } = openStream()
    const sse = createSseWriter(controller)

    sse.queueUpdate(snapshot('first'))
    sse.queueUpdate(snapshot('stalled'))
    // No further event arrives — the model paused. The timer must deliver it.
    vi.advanceTimersByTime(STREAM_FLUSH_INTERVAL_MS)
    controller.close()

    const events = await readEvents()
    expect(events.map(textOf)).toEqual(['first', 'stalled'])
  })

  it('sends again immediately once an interval has passed since the last flush', async () => {
    const { controller, readEvents } = openStream()
    const sse = createSseWriter(controller)

    sse.queueUpdate(snapshot('one'))
    vi.advanceTimersByTime(STREAM_FLUSH_INTERVAL_MS)
    sse.queueUpdate(snapshot('two'))
    controller.close()

    const events = await readEvents()
    expect(events.map(textOf)).toEqual(['one', 'two'])
  })

  it('flushes a queued snapshot ahead of any other event, keeping the order', async () => {
    const { controller, readEvents } = openStream()
    const sse = createSseWriter(controller)

    sse.queueUpdate(snapshot('calling a tool'))
    sse.queueUpdate(snapshot('calling a tool…'))
    sse.send({ type: 'tool_call_start', toolCallId: 't1', toolName: 'grep' })
    sse.close()

    const events = await readEvents()
    expect(events.map((e) => e.type)).toEqual([
      'message_update',
      'message_update',
      'tool_call_start'
    ])
    expect(textOf(events[1])).toBe('calling a tool…')
  })

  it('serializes the live message at flush time, not at queue time', async () => {
    const { controller, readEvents } = openStream()
    const sse = createSseWriter(controller)
    // pi-ai mutates the partial message in place as deltas arrive.
    const live = snapshot('a')
    const block = (live.content as Array<{ text: string }>)[0]

    sse.queueUpdate(snapshot('first'))
    sse.queueUpdate(live)
    block.text = 'ab'
    sse.close()

    const events = await readEvents()
    expect(textOf(events[1])).toBe('ab')
  })

  it('turns writes into no-ops once the client is gone instead of throwing', async () => {
    const { controller, reader } = openStream()
    const sse = createSseWriter(controller)

    await reader.cancel() // what Stop does to the response stream

    expect(() => {
      sse.send({ type: 'title', title: 'x' })
      sse.queueUpdate(snapshot('late'))
      sse.flush()
      sse.close()
    }).not.toThrow()
  })

  it('leaves no timer behind after close', () => {
    const { controller } = openStream()
    const sse = createSseWriter(controller)

    sse.queueUpdate(snapshot('one'))
    sse.queueUpdate(snapshot('two'))
    sse.close()

    expect(vi.getTimerCount()).toBe(0)
  })
})
