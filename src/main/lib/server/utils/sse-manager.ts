export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  // No `Connection`: HTTP/1.1 keeps the connection by default, and HTTP/2
  // (the LAN listener) forbids the header.
  'Cache-Control': 'no-cache'
} as const

/** How often a stream with nothing to say still sends a byte. */
export const SSE_HEARTBEAT_MS = 15_000

const HEARTBEAT = new TextEncoder().encode(': ping\n\n')

/**
 * A comment line every `intervalMs`, so a client can tell a quiet stream (a
 * coding agent's step can run for minutes without an event) from a dead
 * connection — the phone on a mobile network cannot otherwise. Clients
 * ignore comment lines. Stops when the request aborts, when the stream is
 * closed under it, or when the returned function is called.
 */
export function startHeartbeat(
  controller: ReadableStreamDefaultController,
  signal?: AbortSignal,
  intervalMs = SSE_HEARTBEAT_MS
): () => void {
  const timer = setInterval(() => {
    try {
      controller.enqueue(HEARTBEAT)
    } catch {
      stop()
    }
  }, intervalMs)
  const stop = () => clearInterval(timer)
  signal?.addEventListener('abort', stop, { once: true })
  return stop
}

export class SseManager<Topic extends string = string> {
  private topicClients = new Map<Topic, Set<ReadableStreamDefaultController>>()
  private globalClients = new Set<ReadableStreamDefaultController>()
  private encoder = new TextEncoder()

  register(
    topic: Topic,
    controller: ReadableStreamDefaultController,
    signal?: AbortSignal
  ): void {
    if (!this.topicClients.has(topic)) {
      this.topicClients.set(topic, new Set())
    }
    this.topicClients.get(topic)!.add(controller)
    signal?.addEventListener(
      'abort',
      () => this.unregister(topic, controller),
      { once: true }
    )
  }

  unregister(topic: Topic, controller: ReadableStreamDefaultController): void {
    this.topicClients.get(topic)?.delete(controller)
    if (this.topicClients.get(topic)?.size === 0) {
      this.topicClients.delete(topic)
    }
  }

  registerGlobal(
    controller: ReadableStreamDefaultController,
    signal?: AbortSignal
  ): void {
    this.globalClients.add(controller)
    signal?.addEventListener('abort', () => this.unregisterGlobal(controller), {
      once: true
    })
  }

  unregisterGlobal(controller: ReadableStreamDefaultController): void {
    this.globalClients.delete(controller)
  }

  hasClients(topic: Topic): boolean {
    return (this.topicClients.get(topic)?.size ?? 0) > 0
  }

  encodeEvent(event: Record<string, unknown>): Uint8Array {
    return this.encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
  }

  emit(topic: Topic, event: Record<string, unknown>): void {
    const clients = this.topicClients.get(topic)
    if (!clients) return
    const payload = this.encodeEvent(event)
    this._enqueueAll(clients, payload)
  }

  emitGlobal(event: Record<string, unknown>): void {
    const payload = this.encodeEvent(event)
    this._enqueueAll(this.globalClients, payload)
  }

  emitRaw(topic: Topic, payload: Uint8Array): void {
    const clients = this.topicClients.get(topic)
    if (!clients) return
    this._enqueueAll(clients, payload)
  }

  emitGlobalRaw(payload: Uint8Array): void {
    this._enqueueAll(this.globalClients, payload)
  }

  private _enqueueAll(
    clients: Set<ReadableStreamDefaultController>,
    payload: Uint8Array
  ): void {
    for (const controller of clients) {
      try {
        controller.enqueue(payload)
      } catch {
        clients.delete(controller)
      }
    }
  }
}
