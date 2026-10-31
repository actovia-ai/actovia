import { randomUUID } from 'node:crypto'

import { Hono } from 'hono'

import { getSettings } from '../../db/queries'
import type { Variables } from '../../server/types'

/** Reuse the normal chat pipeline: context, tools, model, persistence and jobs. */
export async function runScheduledChat(
  chatId: string,
  prompt: string,
  signal: AbortSignal
): Promise<void> {
  const { default: chat } = await import('../../server/routes/chat')
  const app = new Hono<{ Variables: Variables }>()
  app.use('*', async (c, next) => {
    c.set('settings', await getSettings())
    c.set('scheduled', true)
    await next()
  })
  app.route('/', chat)
  const response = await app.request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: chatId,
      message: {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: prompt }]
      },
      advancedTools: [],
      protocol: 2
    }),
    signal
  })
  if (!response.ok || !response.body)
    throw new Error(`Scheduled chat failed (${response.status})`)
  // Drain incrementally, without retaining the transcript. Stream errors must
  // fail the task too: a 200 SSE response alone does not mean the model ran.
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let pending = ''
  let failure: string | undefined
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      pending += value
      let end
      while ((end = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, end)
        pending = pending.slice(end + 2)
        if (!frame.startsWith('data: ')) continue
        const event = JSON.parse(frame.slice(6))
        if (event.type === 'error') failure = String(event.error)
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (signal.aborted) throw new Error('Scheduled chat interrupted')
  if (failure) throw new Error(failure)
}
