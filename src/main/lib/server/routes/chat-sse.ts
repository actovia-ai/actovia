import type { ChatMessage, ChatSseEvent } from '@actovia/shared/types/chat'

/**
 * How often a streaming message is re-sent, at most. Every `message_update`
 * carries the whole message so far (the renderer and actovia-ios replace by
 * id), so relaying each provider delta costs O(n²) bytes over a long answer —
 * a fast model emits 100+ deltas a second, each one re-serialized here and
 * re-parsed + re-rendered on the other side. ~25 frames a second still reads
 * as smooth and bounds that work.
 */
export const STREAM_FLUSH_INTERVAL_MS = 40

export interface SseWriter {
  /** Writes an event now, after any queued update (order is preserved). */
  send(event: ChatSseEvent): void
  /** Queues a streaming snapshot; only the latest one per interval is sent. */
  queueUpdate(message: ChatMessage): void
  flush(): void
  close(): void
}

export function createSseWriter(
  controller: ReadableStreamDefaultController<Uint8Array>
): SseWriter {
  const encoder = new TextEncoder()
  let clientGone = false
  let pending: ChatMessage | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastFlushAt = 0

  function write(event: ChatSseEvent) {
    if (clientGone) return
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    } catch {
      // The client hung up (Stop, a closed window): the stream is cancelled
      // and `enqueue` throws from here on. That must not unwind the caller —
      // the turn still has to be saved — so writes just become no-ops.
      clientGone = true
    }
  }

  function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending) return
    const message = pending
    pending = null
    lastFlushAt = Date.now()
    write({ type: 'message_update', message })
  }

  return {
    send(event) {
      flush()
      write(event)
    },
    queueUpdate(message) {
      pending = message
      const wait = STREAM_FLUSH_INTERVAL_MS - (Date.now() - lastFlushAt)
      if (wait <= 0) flush()
      // Trailing edge: without it the last delta before a pause (a slow
      // provider, a model that stops to think) would sit unsent until the
      // next event arrived.
      else if (!timer) timer = setTimeout(flush, wait)
    },
    flush,
    close() {
      flush()
      if (clientGone) return
      try {
        controller.close()
      } catch {
        // Cancelled between the last write and here — already closed.
      }
    }
  }
}
