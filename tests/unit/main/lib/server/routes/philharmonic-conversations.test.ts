// src/main/lib/server/routes/philharmonic-conversations.test.ts
import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/server/utils', () => ({
  getRequiredParam: (_c: unknown, _k: string) => 'id',
  handleDatabaseOperation: (fn: () => unknown) => fn(),
  successResponse: (c: { json: (d: unknown) => unknown }, data: unknown) =>
    c.json(data),
  deletionSuccessResponse: (c: { json: (d: unknown) => unknown }) =>
    c.json({ success: true }),
  validateSchema: (
    s: { safeParse: (d: unknown) => { success: boolean; data?: unknown } },
    d: unknown
  ) => {
    const r = s.safeParse(d)
    if (!r.success) throw new Error('invalid')
    return r.data
  }
}))
const fitImageDataUrl = vi.fn((url: string, contentType: string) => ({
  url: `${url}#fitted`,
  contentType
}))
vi.mock('@main/lib/ai/utils/image-fit', () => ({
  fitImageDataUrl: (url: string, contentType: string) =>
    fitImageDataUrl(url, contentType)
}))
vi.mock('@main/lib/db/philharmonic-queries', () => ({
  getPhilharmonicCostRows: getPhilharmonicCostRows
}))
const getPhilharmonicCostRows = vi.fn()
const getPmCostRows = vi.fn(async (_since?: Date) => [])
vi.mock('@main/lib/db/pm-round-queries', () => ({
  getPmCostRows: (since?: Date) => getPmCostRows(since),
  listRoundEvents: vi.fn(async () => [])
}))
const deleteConversation = vi.fn(async () => {
  order.push('delete')
})
const getMessagesByConversationId = vi.fn(async (_id: string) => [{ id: 'm1' }])
const getMessagesAfter = vi.fn(
  async (_id: string, _after: string): Promise<{ id: string }[] | null> => [
    { id: 'm2' }
  ]
)
const createConversationMessage = vi.fn(async (_row: unknown) => ({
  id: 'new'
}))
vi.mock('@main/lib/db/conversation-queries', () => ({
  deleteConversation,
  createConversationMessage: (row: unknown) => createConversationMessage(row),
  getMessagesByConversationId: (id: string) => getMessagesByConversationId(id),
  getMessagesAfter: (id: string, after: string) => getMessagesAfter(id, after)
}))
const removeGroupMedia = vi.fn(async () => {})
vi.mock('@main/lib/media/store', () => ({ removeGroupMedia }))
vi.mock('@main/lib/ai/philharmonic/pm-coordinator', () => ({
  runPmCoordinator: (input: unknown) => runPmCoordinator(input)
}))
vi.mock('@main/lib/ai/philharmonic/ask-user-registry', () => ({
  askUserRegistry: { resolve: vi.fn() }
}))
const closeTopic = vi.fn((_topic: string) => {
  order.push('close streams')
})
vi.mock('@main/lib/server/routes/philharmonic-sse', () => ({
  emitToConversation: vi.fn(),
  sseManager: { closeTopic: (topic: string) => closeTopic(topic) }
}))
const order: string[] = []
const abort = vi.fn((_id: string) => {
  order.push('abort')
  return true
})
const runPmCoordinator = vi.fn(async (_input: unknown) => {})
vi.mock('@main/lib/ai/philharmonic/pm-run-registry', () => ({
  pmRunRegistry: {
    abort: (id: string) => abort(id),
    set: vi.fn(),
    clear: vi.fn()
  }
}))
const stopConversation = vi.fn(async (_id: string) => {
  order.push('stop agents')
})
vi.mock('@main/lib/agents/registry', () => ({
  agentRegistry: { stopConversation: (id: string) => stopConversation(id) }
}))

const { default: conversationsRouter } =
  await import('@main/lib/server/routes/philharmonic-conversations')

describe('DELETE /conversations/:id', () => {
  it('removes the Group’s generated media with it', async () => {
    const { Hono } = await import('hono')
    const app = new Hono()
    app.route('/', conversationsRouter)

    const res = await app.request('/conversations/id', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(deleteConversation).toHaveBeenCalledWith('id')
    expect(removeGroupMedia).toHaveBeenCalledWith('id')
  })

  it('stops the PM and every agent working for the group before deleting it', async () => {
    const { Hono } = await import('hono')
    const app = new Hono()
    app.route('/', conversationsRouter)
    order.length = 0

    await app.request('/conversations/id', { method: 'DELETE' })

    expect(abort).toHaveBeenCalledWith('id')
    expect(stopConversation).toHaveBeenCalledWith('id')
    expect(order).toEqual(['abort', 'stop agents', 'delete', 'close streams'])
  })

  it('ends the streams still watching the group once it is gone (ISSUE-249)', async () => {
    const { Hono } = await import('hono')
    const app = new Hono()
    app.route('/', conversationsRouter)

    await app.request('/conversations/id', { method: 'DELETE' })

    expect(closeTopic).toHaveBeenCalledWith('id')
  })
})

describe('GET /conversations/:id/messages', () => {
  async function request(path: string) {
    const { Hono } = await import('hono')
    const { NotFoundError } = await import('@actovia/shared/errors/app-error')
    const app = new Hono()
    app.onError((err, c) =>
      c.json({}, err instanceof NotFoundError ? 404 : 500)
    )
    app.route('/', conversationsRouter)
    return app.request(path)
  }

  it('reads every row without `after`', async () => {
    const res = await request('/conversations/id/messages')
    expect(await res.json()).toEqual([{ id: 'm1' }])
    expect(getMessagesByConversationId).toHaveBeenCalledWith('id')
  })

  it('reads the rows after the given one', async () => {
    getMessagesByConversationId.mockClear()
    const res = await request('/conversations/id/messages?after=x')
    expect(await res.json()).toEqual([{ id: 'm2' }])
    expect(getMessagesAfter).toHaveBeenCalledWith('id', 'x')
    expect(getMessagesByConversationId).not.toHaveBeenCalled()
  })

  it('answers 404 for an anchor that is not a row of the group', async () => {
    getMessagesAfter.mockResolvedValueOnce(null)
    const res = await request('/conversations/id/messages?after=gone')
    expect(res.status).toBe(404)
  })
})

describe('POST /conversations/:id/messages', () => {
  async function post(body: unknown) {
    const { Hono } = await import('hono')
    const app = new Hono()
    app.onError((_err, c) => c.json({}, 400))
    app.route('/', conversationsRouter)
    return app.request('/conversations/id/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  }
  const photo = (url: string) => ({
    content: 'look',
    attachments: [{ name: 'a.png', url, contentType: 'image/png' }]
  })

  it('refuses an image attachment that is a link, not a data URL', async () => {
    createConversationMessage.mockClear()
    const res = await post(photo('https://bucket.s3.amazonaws.com/a.png'))
    expect(res.status).toBe(400)
    expect(createConversationMessage).not.toHaveBeenCalled()
  })

  it('saves and hands the PM the fitted picture', async () => {
    createConversationMessage.mockClear()
    const res = await post(photo('data:image/png;base64,AAAA'))
    expect(res.status).toBe(200)
    expect(fitImageDataUrl).toHaveBeenCalledWith(
      'data:image/png;base64,AAAA',
      'image/png'
    )
    const row = createConversationMessage.mock.calls[0][0] as {
      parts: { url: string }[]
    }
    expect(row.parts[0].url).toBe('data:image/png;base64,AAAA#fitted')
    const input = runPmCoordinator.mock.calls.at(-1)?.[0] as {
      attachments: { url: string }[]
    }
    expect(input.attachments[0].url).toBe('data:image/png;base64,AAAA#fitted')
  })
})

describe('GET /costs', () => {
  // ISSUE-235: the Costs page and its route are gone.
  it('is not served', async () => {
    const { Hono } = await import('hono')
    const app = new Hono()
    app.route('/', conversationsRouter)
    const res = await app.request('/costs?days=7')
    expect(res.status).toBe(404)
  })
})
