import type { PhilharmonicSseEvent } from '@actovia/shared/types/philharmonic'
import { Hono } from 'hono'

import type { Variables } from '../types'
import { getRequiredParam } from '../utils'
import { SSE_HEADERS, SseManager } from '../utils/sse-manager'

export const sseManager = new SseManager<string>()

// emitToTask notifies both task-specific clients AND global clients
export function emitToTask(taskId: string, event: PhilharmonicSseEvent): void {
  // Encode once, send to both topic and global clients
  const payload = sseManager.encodeEvent(event)
  sseManager.emitRaw(taskId, payload)
  sseManager.emitGlobalRaw(payload)
}

export function emitToAll(event: PhilharmonicSseEvent): void {
  sseManager.emitGlobal(event)
}

// Emit a conversation-scoped event to clients watching that conversation.
export function emitToConversation(
  conversationId: string,
  event: PhilharmonicSseEvent
): void {
  const payload = sseManager.encodeEvent(event)
  sseManager.emitRaw(conversationId, payload)
  sseManager.emitGlobalRaw(payload)
}

const philharmonicSse = new Hono<{ Variables: Variables }>()

philharmonicSse.get('/tasks/:id/sse', (c) => {
  const id = getRequiredParam(c, 'id')

  const stream = new ReadableStream({
    start(controller) {
      sseManager.register(id, controller, c.req.raw.signal)
    }
  })

  return new Response(stream, { headers: SSE_HEADERS })
})

philharmonicSse.get('/sse', (c) => {
  const stream = new ReadableStream({
    start(controller) {
      sseManager.registerGlobal(controller, c.req.raw.signal)
    }
  })

  return new Response(stream, { headers: SSE_HEADERS })
})

philharmonicSse.get('/conversations/:id/sse', (c) => {
  const id = getRequiredParam(c, 'id')
  const stream = new ReadableStream({
    start(controller) {
      sseManager.register(id, controller, c.req.raw.signal)
    }
  })
  return new Response(stream, { headers: SSE_HEADERS })
})

export default philharmonicSse
