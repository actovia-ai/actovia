import type { Variables } from '@main/lib/server/types'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = { id: 'settings' }
const observe = vi.fn()
let fail = false
vi.mock('@main/lib/db/queries', () => ({
  getSettings: vi.fn(async () => settings)
}))
vi.mock('@main/lib/server/routes/chat', () => {
  const chat = new Hono<{ Variables: Variables }>()
  chat.post('/', async (c) => {
    observe(await c.req.json(), c.get('settings'), c.get('scheduled'))
    const encoder = new TextEncoder()
    const data = JSON.stringify(
      fail
        ? { type: 'error', error: 'Provider failed' }
        : { type: 'done', messages: [] }
    )
    return new Response(
      new ReadableStream({
        start(controller) {
          const frame = `data: ${data}\n\n`
          controller.enqueue(encoder.encode(frame.slice(0, 10)))
          controller.enqueue(encoder.encode(frame.slice(10)))
          controller.close()
        }
      })
    )
  })
  return { default: chat }
})

const { runScheduledChat } =
  await import('@main/lib/ai/philharmonic/scheduled-chat')
beforeEach(() => {
  vi.clearAllMocks()
  fail = false
})
describe('scheduled normal chat', () => {
  it('uses fresh settings and the unattended flag on the same chat route', async () => {
    await runScheduledChat('chat-1', 'Report', new AbortController().signal)
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'chat-1',
        message: expect.objectContaining({
          role: 'user',
          content: [{ type: 'text', text: 'Report' }]
        })
      }),
      settings,
      true
    )
  })
  it('treats an SSE error as failed even when HTTP returned 200', async () => {
    fail = true
    await expect(
      runScheduledChat('chat-1', 'Report', new AbortController().signal)
    ).rejects.toThrow('Provider failed')
  })
})
