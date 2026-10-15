// What the model is sent once a chat has regenerate groups (spec 2026-09-26
// §3), through the chat route: real SQL on an in-memory PGlite (migrations
// through 0011), the real LCM assembler and the real kernel on pi's faux
// provider, which records the request it was given. Collaborators that reach
// the network, the job queue or an LLM are mocked.
import { randomUUID } from 'crypto'

import {
  type Context,
  fauxAssistantMessage,
  fauxText
} from '@earendil-works/pi-ai'
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
// The job queue is not under test. A run's messages enter what LCM tracks as
// they are saved (`RunRecorder.persist`); the `lcm-post-turn` job only
// compacts, which a chat this short never needs.
const jobs = vi.hoisted(() => ({ running: [] as Promise<unknown>[] }))
vi.mock('@main/lib/jobs/worker', () => ({
  enqueueAndProcess: vi.fn(() => {
    const job = Promise.resolve()
    jobs.running.push(job)
    return job
  }),
  logEnqueueFailure: vi.fn()
}))
vi.mock('@main/lib/logger/trace-context', () => ({
  bindTraceAttributes: vi.fn()
}))
const { pglite } = await import('@main/lib/db/db')
const { default: chat } = await import('@main/lib/server/routes/chat')
const { registerFauxProvider } = await import('@main/lib/ai/kernel/faux')
const { errorHandler } = await import('@main/lib/server/middlewares')

afterAll(async () => {
  await pglite.close()
})

function buildApp(lcmEnabled: boolean) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('settings', {
      id: 'settings-1',
      memory: { lcmEnabled, autoCapture: false, useInChat: false }
    } as never)
    await next()
  })
  app.route('/api/v1/chat', chat)
  app.onError(errorHandler)
  return app
}

type Wire = Record<string, unknown> & { id: string; role: string }

function sseEvents(
  body: string
): Array<Record<string, unknown> & { type: string }> {
  return body
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice(6)))
}

let clock = Date.parse('2026-01-01T00:00:00Z')
let takes = 0

/**
 * One run through the route. Returns the conversation as `done` echoes it,
 * and what the provider was sent: the text of every message of the request.
 */
async function send(
  app: Hono,
  chatId: string,
  prior: Wire[],
  question: string,
  prompt: { alternateOf?: string } = {}
) {
  let request: string[] = []
  const faux = registerFauxProvider()
  const answer = `answer ${++takes}`
  faux.setResponses([
    (ctx: Context) => {
      // The conversation only: pi 1.0 leads the transcript with the system
      // message, which these cases do not compare.
      request = ctx.messages
        .filter((m) => m.role !== 'system')
        .map((m) =>
          typeof m.content === 'string'
            ? m.content
            : m.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
        )
      return fauxAssistantMessage([fauxText(answer)])
    }
  ])
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
          content: question,
          timestamp: clock,
          ...prompt
        }
      ],
      advancedTools: []
    })
  })
  const events = sseEvents(await res.text())
  await Promise.all(jobs.running.splice(0))
  expect(events.filter((e) => e.type === 'error')).toEqual([])
  const done = events.find((e) => e.type === 'done') as { messages: Wire[] }
  return { runId, answer, messages: done.messages, request }
}

function choose(app: Hono, chatId: string, runId: string) {
  return app.request(`/api/v1/chat/${chatId}/choose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId })
  })
}

// Both ways a request gets its history: assembled from the database (LCM,
// the default) and taken from what the client posted (LCM off).
describe.each([
  { name: 'with LCM', lcmEnabled: true },
  { name: 'with LCM off', lcmEnabled: false }
])('what the model is sent, $name', ({ lcmEnabled }) => {
  it('a regenerate is sent the question alone — not the answer it stands beside', async () => {
    const app = buildApp(lcmEnabled)
    const chatId = randomUUID()
    const before = await send(app, chatId, [], 'an earlier question')
    const first = await send(app, chatId, before.messages, 'the question')

    const regen = await send(app, chatId, first.messages, 'the question', {
      alternateOf: first.runId
    })

    expect(regen.request).toEqual([
      'an earlier question',
      before.answer,
      'the question'
    ])
  })

  it('the next message is sent the answer that was kept, and only that one', async () => {
    const app = buildApp(lcmEnabled)
    const chatId = randomUUID()
    const first = await send(app, chatId, [], 'the question')
    const regen = await send(app, chatId, first.messages, 'the question', {
      alternateOf: first.runId
    })
    expect((await choose(app, chatId, first.runId)).status).toBe(200)

    // The client still holds the states it saw last; the server's are what count.
    const next = await send(app, chatId, regen.messages, 'and then?')

    expect(next.request).toEqual(['the question', first.answer, 'and then?'])
  })

  it('a message sent mid-comparison is sent the newer answer', async () => {
    const app = buildApp(lcmEnabled)
    const chatId = randomUUID()
    const first = await send(app, chatId, [], 'the question')
    const regen = await send(app, chatId, first.messages, 'the question', {
      alternateOf: first.runId
    })

    const next = await send(app, chatId, regen.messages, 'and then?')

    expect(next.request).toEqual(['the question', regen.answer, 'and then?'])
  })
})
