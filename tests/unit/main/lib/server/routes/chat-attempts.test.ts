// Regenerate groups through the chat route (spec 2026-09-26 §2): a Regenerate
// (`alternateOf` on the new user message) opens a comparison, the next
// ordinary run settles it, `POST /:chatId/choose` picks one, and
// `GET /:id` carries the state. Real SQL on an in-memory PGlite (migrations
// through 0011), the real kernel on pi's faux provider, behind the same
// presence gate the app stacks; collaborators that reach the network, the
// job queue or an LLM are mocked.
import { randomUUID } from 'crypto'

import { fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai'
import { Hono } from 'hono'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false }
}))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/db/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite')
  const { createMigratedPglite } =
    await import('../../../../helpers/migrated-pglite')
  const pglite = await createMigratedPglite('0012')
  return { pglite, db: drizzle(pglite) }
})
vi.mock('@main/lib/ai/context-management', () => ({
  trackContextMessages: vi.fn(async () => {}),
  freshTailRuns: () => 6,
  LcmManager: class {
    trackNewMessages = vi.fn(async () => {})
    assembleContext = vi.fn(async () => ({ messages: [] }))
    compactAfterTurn = vi.fn(async () => {})
  }
}))
vi.mock('@main/lib/ai/mcp', () => ({ getMcpTools: vi.fn(async () => []) }))
vi.mock('@main/lib/ai/memory/manager', () => ({
  loadRunMemoryBlocks: vi.fn(async () => new Map()),
  loadRelevantMemories: vi.fn(async () => [])
}))
vi.mock('@main/lib/ai/prompts', () => ({
  buildPersonalityPrompt: vi.fn(() => ''),
  deepResearchBootPrompt: 'DEEP_RESEARCH_BOOT',
  getSystemPrompt: vi.fn(() => 'SYSTEM')
}))
vi.mock('@main/lib/ai/skills/skills-manager', () => ({
  getActiveSkillsIndex: vi.fn(async () => '')
}))
const getModelFromProviderMock = vi.fn()
vi.mock('@main/lib/ai/utils/chat-message-util', () => ({
  bindCallingTools: () => [],
  generateTitleFromUserMessage: vi.fn(async () => 'A title'),
  getModelFromProvider: (...args: unknown[]) =>
    getModelFromProviderMock(...args),
  getTextFromMessage: vi.fn((m: { content: unknown }) =>
    typeof m.content === 'string' ? m.content : ''
  )
}))
vi.mock('@main/lib/jobs/worker', () => ({
  enqueueAndProcess: vi.fn(async () => {}),
  logEnqueueFailure: vi.fn()
}))
vi.mock('@main/lib/logger/trace-context', () => ({
  bindTraceAttributes: vi.fn()
}))
const { pglite } = await import('@main/lib/db/db')
const { default: chat } = await import('@main/lib/server/routes/chat')
const { registerFauxProvider } = await import('@main/lib/ai/kernel/faux')
const { errorHandler, presenceGate } =
  await import('@main/lib/server/middlewares')
const { needsPresence } =
  await import('@main/lib/server/middlewares/presence-gate')

afterAll(async () => {
  await pglite.close()
})

function buildApp() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('settings', {
      id: 'settings-1',
      memory: { lcmEnabled: true, autoCapture: false, useInChat: false }
    } as never)
    await next()
  })
  app.use('/api/*', presenceGate)
  app.route('/api/v1/chat', chat)
  app.onError(errorHandler)
  return app
}

type Wire = Record<string, unknown> & {
  id: string
  runId: string
  role: string
  attempt?: string | null
  alternateOf?: string | null
}

function sseEvents(
  body: string
): Array<Record<string, unknown> & { type: string }> {
  return body
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice(6)))
}

let clock = Date.parse('2026-01-01T00:00:00Z')

/** One run through the route; returns the `done` event's messages. */
async function send(
  app: Hono,
  chatId: string,
  prior: Wire[],
  prompt: { alternateOf?: string } = {}
): Promise<{ runId: string; messages: Wire[] }> {
  const faux = registerFauxProvider()
  faux.setResponses([fauxAssistantMessage([fauxText('An answer.')])])
  getModelFromProviderMock.mockReturnValue({
    model: faux.getModel(),
    apiKey: 'k'
  })
  const runId = randomUUID()
  clock += 60_000
  const res = await app.request('/api/v1/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: chatId,
      messages: [
        ...prior,
        {
          id: runId,
          role: 'user',
          content: 'the question',
          timestamp: clock,
          // A client-sent attempt is never trusted.
          attempt: 'chosen',
          ...prompt
        }
      ],
      advancedTools: []
    })
  })
  const events = sseEvents(await res.text())
  expect(events.some((e) => e.type === 'error')).toBe(false)
  const done = events.find((e) => e.type === 'done') as {
    messages: Wire[]
  }
  return { runId, messages: done.messages }
}

async function stored(chatId: string) {
  const { rows } = await pglite.query<{
    id: string
    attempt: string | null
    alternateOf: string | null
  }>(
    `SELECT "id","attempt","alternateOf" FROM "message"
     WHERE "chatId" = $1 AND "role" = 'user' ORDER BY "createdAt"`,
    [chatId]
  )
  return rows
}

function choose(app: Hono, chatId: string, runId: string) {
  return app.request(`/api/v1/chat/${chatId}/choose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId })
  })
}

describe('regenerate through POST /api/v1/chat', () => {
  it('opens a comparison and echoes the stored state in `done`', async () => {
    const app = buildApp()
    const chatId = randomUUID()
    const first = await send(app, chatId, [])
    const regen = await send(app, chatId, first.messages, {
      alternateOf: first.runId
    })

    expect(await stored(chatId)).toEqual([
      { id: first.runId, attempt: 'comparing', alternateOf: null },
      { id: regen.runId, attempt: 'comparing', alternateOf: first.runId }
    ])
    const users = regen.messages.filter((m) => m.role === 'user')
    expect(users.map((m) => [m.id, m.attempt ?? null])).toEqual([
      [first.runId, 'comparing'],
      [regen.runId, 'comparing']
    ])
    expect(users[1].alternateOf).toBe(first.runId)
  })

  it('an ordinary run ignores a client-sent attempt and settles an open comparison', async () => {
    const app = buildApp()
    const chatId = randomUUID()
    const first = await send(app, chatId, [])
    expect((await stored(chatId))[0].attempt).toBeNull()

    const regen = await send(app, chatId, first.messages, {
      alternateOf: first.runId
    })
    const next = await send(app, chatId, regen.messages)

    expect(await stored(chatId)).toEqual([
      { id: first.runId, attempt: 'folded', alternateOf: null },
      { id: regen.runId, attempt: 'chosen', alternateOf: first.runId },
      { id: next.runId, attempt: null, alternateOf: null }
    ])
    const users = next.messages.filter((m) => m.role === 'user')
    expect(users.map((m) => m.attempt ?? null)).toEqual([
      'folded',
      'chosen',
      null
    ])
  })

  it('404 RUN_NOT_FOUND when the group is not in the chat', async () => {
    const app = buildApp()
    const chatId = randomUUID()
    await send(app, chatId, [])
    const before = await stored(chatId)
    const res = await app.request('/api/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: chatId,
        messages: [
          {
            id: randomUUID(),
            role: 'user',
            content: 'q',
            alternateOf: randomUUID()
          }
        ],
        advancedTools: []
      })
    })
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).toContain('RUN_NOT_FOUND')
    // Nothing was written for the refused prompt.
    expect(await stored(chatId)).toEqual(before)
  })

  it('stores the group’s first run when the client names a later one', async () => {
    const app = buildApp()
    const chatId = randomUUID()
    const first = await send(app, chatId, [])
    const regen = await send(app, chatId, first.messages, {
      alternateOf: first.runId
    })
    const third = await send(app, chatId, regen.messages, {
      alternateOf: regen.runId
    })
    expect(await stored(chatId)).toEqual([
      { id: first.runId, attempt: 'hidden', alternateOf: null },
      { id: regen.runId, attempt: 'comparing', alternateOf: first.runId },
      { id: third.runId, attempt: 'comparing', alternateOf: first.runId }
    ])
  })
})

describe('POST /api/v1/chat/:chatId/choose', () => {
  it('is not behind the presence gate (actovia-ios calls it over the LAN)', () => {
    expect(needsPresence(`/api/v1/chat/${randomUUID()}/choose`)).toBe(false)
  })

  it('chooses, swaps while last, and locks once the chat moves on', async () => {
    const app = buildApp()
    const chatId = randomUUID()
    const first = await send(app, chatId, [])
    const regen = await send(app, chatId, first.messages, {
      alternateOf: first.runId
    })

    // No presence token: loopback callers (the window, tests/api) may choose.
    const chosen = await choose(app, chatId, first.runId)
    expect(chosen.status).toBe(200)
    expect(await chosen.json()).toEqual({
      attempts: { [first.runId]: 'chosen', [regen.runId]: 'folded' }
    })

    // Idempotent.
    const again = await choose(app, chatId, first.runId)
    expect(await again.json()).toEqual({
      attempts: { [first.runId]: 'chosen', [regen.runId]: 'folded' }
    })

    // Swap while the group is the last exchange.
    const swapped = await choose(app, chatId, regen.runId)
    expect(await swapped.json()).toEqual({
      attempts: { [first.runId]: 'folded', [regen.runId]: 'chosen' }
    })

    await send(app, chatId, regen.messages)
    const locked = await choose(app, chatId, first.runId)
    expect(locked.status).toBe(409)
    expect(JSON.stringify(await locked.json())).toContain('ATTEMPT_LOCKED')
  })

  it('404 RUN_NOT_FOUND for an unknown run; 400 for a malformed body or chat id', async () => {
    const app = buildApp()
    const chatId = randomUUID()
    await send(app, chatId, [])

    const unknown = await choose(app, chatId, randomUUID())
    expect(unknown.status).toBe(404)
    expect(JSON.stringify(await unknown.json())).toContain('RUN_NOT_FOUND')

    expect((await choose(app, chatId, 'not-a-uuid')).status).toBe(400)
    expect((await choose(app, 'not-a-chat', randomUUID())).status).toBe(400)
  })
})

describe('GET /api/v1/chat/:id', () => {
  it('carries alternateOf and attempt on the user rows', async () => {
    const app = buildApp()
    const chatId = randomUUID()
    const first = await send(app, chatId, [])
    const regen = await send(app, chatId, first.messages, {
      alternateOf: first.runId
    })
    await choose(app, chatId, regen.runId)

    const res = await app.request(`/api/v1/chat/${chatId}`)
    const rows = (await res.json()) as Wire[]
    const users = rows.filter((r) => r.role === 'user')
    expect(users.map((r) => [r.id, r.alternateOf, r.attempt])).toEqual([
      [first.runId, null, 'folded'],
      [regen.runId, first.runId, 'chosen']
    ])
    for (const r of rows.filter((r) => r.role !== 'user')) {
      expect(r.attempt).toBeNull()
      expect(r.alternateOf).toBeNull()
    }
  })
})

// The history a page at a time (spec 2026-10-01 §C3); `chat/page.ts` has the
// paging rules, this is the route.
describe('GET /api/v1/chat/:id/page', () => {
  it('answers the newest runs and the chat’s outline', async () => {
    const app = buildApp()
    const chatId = randomUUID()
    const first = await send(app, chatId, [])
    const second = await send(app, chatId, first.messages)

    const res = await app.request(`/api/v1/chat/${chatId}/page?runs=1`)
    expect(res.status).toBe(200)
    const page = (await res.json()) as {
      messages: Wire[]
      questions: { runId: string }[]
      hasOlder: boolean
      olderCursor: string | null
    }
    expect(new Set(page.messages.map((m) => m.runId))).toEqual(
      new Set([second.runId])
    )
    expect(page.questions.map((q) => q.runId)).toEqual([
      first.runId,
      second.runId
    ])
    expect(page.hasOlder).toBe(true)
    expect(page.olderCursor).toBe(second.runId)

    const older = await app.request(
      `/api/v1/chat/${chatId}/page?runs=1&before=${page.olderCursor}`
    )
    const olderPage = (await older.json()) as { messages: Wire[] }
    expect(new Set(olderPage.messages.map((m) => m.runId))).toEqual(
      new Set([first.runId])
    )
  })

  it('400 for a bad page size or cursor; 404 for a run not in the chat', async () => {
    const app = buildApp()
    const chatId = randomUUID()
    await send(app, chatId, [])
    expect(
      (await app.request(`/api/v1/chat/${chatId}/page?runs=0`)).status
    ).toBe(400)
    expect(
      (await app.request(`/api/v1/chat/${chatId}/page?before=nope`)).status
    ).toBe(400)
    expect(
      (await app.request(`/api/v1/chat/${chatId}/page?before=${randomUUID()}`))
        .status
    ).toBe(404)
  })
})

describe('GET /api/v1/chat/:id/messages/:messageId', () => {
  it('answers one row whole, and 404 for another chat’s', async () => {
    const app = buildApp()
    const chatId = randomUUID()
    const first = await send(app, chatId, [])
    const res = await app.request(
      `/api/v1/chat/${chatId}/messages/${first.runId}`
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as Wire).id).toBe(first.runId)
    const elsewhere = await app.request(
      `/api/v1/chat/${randomUUID()}/messages/${first.runId}`
    )
    expect(elsewhere.status).toBe(404)
  })
})
