import type { PhilharmonicSseEvent } from '@actovia/shared/types/philharmonic'
import { Hono } from 'hono'

import { askUserRegistry } from '../../ai/philharmonic/ask-user-registry'
import { pmRunRegistry } from '../../ai/philharmonic/pm-run-registry'
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

// A client that opens the group mid-round (a reload, another page and back,
// the phone) missed `pm_started` and any `ask_user`: they are live events,
// and without them the PM waits on a question nobody can see.
philharmonicSse.get('/conversations/:id/sse', (c) => {
  const id = getRequiredParam(c, 'id')
  const stream = new ReadableStream({
    start(controller) {
      sseManager.register(id, controller, c.req.raw.signal)
      if (pmRunRegistry.has(id)) {
        controller.enqueue(
          sseManager.encodeEvent({ type: 'pm_started', conversationId: id })
        )
      }
      const ask = askUserRegistry.question(id)
      if (ask) {
        controller.enqueue(
          sseManager.encodeEvent({
            type: 'ask_user',
            conversationId: id,
            ...ask
          })
        )
      }
    }
  })
  return new Response(stream, { headers: SSE_HEADERS })
})

export default philharmonicSse
