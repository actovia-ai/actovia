import type { Model } from '@earendil-works/pi-ai'
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options'
import type { ConversationMessage } from '@main/lib/db/schema'
// src/main/lib/ai/philharmonic/lcm/index.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Logger transitively pulls in Electron — short-circuit it before the module
// graph tries to load.
vi.mock('@main/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// Mocks have to land BEFORE we import the module under test so the dynamic
// imports inside resolve to the stubs.
const getMessagesByConversationId = vi.fn()
const getSessionSummary = vi.fn()
const upsertSessionSummary = vi.fn()
const summarizeMessages = vi.fn()
const getAllAgents = vi.fn()

vi.mock('@main/lib/db/philharmonic-queries', () => ({ getAllAgents }))
vi.mock('@main/lib/db/conversation-queries', () => ({
  getMessagesByConversationId
}))
vi.mock('@main/lib/ai/philharmonic/lcm/queries', () => ({
  getSessionSummary,
  upsertSessionSummary
}))
vi.mock('@main/lib/ai/philharmonic/lcm/summarize', () => ({
  summarizeMessages
}))
// Token counter is pure but pulls Drizzle types through transitively in the
// real module; stub it out for predictability.
vi.mock('@main/lib/ai/context-management/token-counter', () => ({
  estimateMessageTokens: (content: unknown) =>
    typeof content === 'string'
      ? content.length
      : JSON.stringify(content).length,
  estimateTokens: (s: string) => s.length
}))

const { PhilharmonicLcm } = await import('@main/lib/ai/philharmonic/lcm/index')

function makeMessage(over: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: 'm',
    conversationId: 'c1',
    role: 'user',
    agentId: null,
    content: 'hello',
    parts: null,
    taskId: null,
    createdAt: new Date('2026-06-05T00:00:00Z'),
    ...over
  } as ConversationMessage
}

const fakeModel = { id: 'gpt-4.1-mini' } as never

beforeEach(() => {
  getMessagesByConversationId.mockReset()
  getSessionSummary.mockReset()
  upsertSessionSummary.mockReset()
  summarizeMessages.mockReset()
  getAllAgents.mockReset()
  getAllAgents.mockResolvedValue([])
})

describe('assembleContext', () => {
  it('prefixes an employee row with its label', async () => {
    getMessagesByConversationId.mockResolvedValue([
      makeMessage({
        id: 'e',
        role: 'employee',
        agentId: 'a1',
        content: 'Done'
      }),
      makeMessage({
        id: 'f',
        role: 'employee',
        agentId: 'gone',
        content: 'Hi'
      }),
      makeMessage({ id: 'p', role: 'pm', content: 'ok' })
    ])
    getAllAgents.mockResolvedValue([
      { id: 'a1', name: 'CC', runtime: 'claude-code', model: null }
    ])
    const lcm = new PhilharmonicLcm('c1', fakeModel, 'k', {
      enabled: false
    } as never)
    const out = (await lcm.assembleContext()) as any[]
    expect(out[0].content[0].text).toBe('[CC · Claude Code · CLI default] Done')
    expect(out[1].content[0].text).toBe('[former employee] Hi')
    expect(out[2].content[0].text).toBe('ok')
  })

  it('returns every message untouched when disabled', async () => {
    const rows = [
      makeMessage({ id: 'a', role: 'user', content: 'hi' }),
      makeMessage({ id: 'b', role: 'pm', content: 'thinking…' })
    ]
    getMessagesByConversationId.mockResolvedValue(rows)
    const lcm = new PhilharmonicLcm('c1', fakeModel, 'k', { enabled: false })
    const out = await lcm.assembleContext()
    expect(out).toHaveLength(2)
    expect(out[0].role).toBe('user')
    expect(out[1].role).toBe('assistant')
    // Even disabled, the summary table should never be queried.
    expect(getSessionSummary).not.toHaveBeenCalled()
  })

  it('returns every message untouched when no summary exists', async () => {
    const rows = [makeMessage({ id: 'a' })]
    getMessagesByConversationId.mockResolvedValue(rows)
    getSessionSummary.mockResolvedValue(null)
    const lcm = new PhilharmonicLcm('c1', fakeModel, 'k', {})
    const out = await lcm.assembleContext()
    expect(out).toHaveLength(1)
  })

  it('replaces messages up to and including the boundary with the summary', async () => {
    const rows = [
      makeMessage({ id: 'a', role: 'user', content: 'first' }),
      makeMessage({ id: 'b', role: 'pm', content: 'second' }),
      makeMessage({ id: 'c', role: 'user', content: 'third' }),
      makeMessage({ id: 'd', role: 'pm', content: 'fourth' })
    ]
    getMessagesByConversationId.mockResolvedValue(rows)
    getSessionSummary.mockResolvedValue({
      id: 's1',
      conversationId: 'c1',
      content: 'we talked about X',
      coversThroughMessageId: 'b',
      tokenCount: 12,
      messageCount: 2,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    const lcm = new PhilharmonicLcm('c1', fakeModel, 'k', {})
    const out = await lcm.assembleContext()
    // [summary user message, c, d]
    expect(out).toHaveLength(3)
    const summaryText = (out[0].content as Array<{ text: string }>)[0].text
    expect(summaryText).toContain('ph_summary')
    expect(summaryText).toContain('we talked about X')
    expect((out[2].content as Array<{ text: string }>)[0].text).toBe('fourth')
  })

  it('falls back to full history when the boundary message is missing', async () => {
    const rows = [
      makeMessage({ id: 'a', content: 'one' }),
      makeMessage({ id: 'b', content: 'two' })
    ]
    getMessagesByConversationId.mockResolvedValue(rows)
    getSessionSummary.mockResolvedValue({
      id: 's1',
      conversationId: 'c1',
      content: 'stale',
      coversThroughMessageId: 'deleted',
      tokenCount: 3,
      messageCount: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    const lcm = new PhilharmonicLcm('c1', fakeModel, 'k', {})
    const out = await lcm.assembleContext()
    expect(out).toHaveLength(2)
  })

  // Every provider estimates the context from the `usage` of its assistant
  // messages before it sends anything; a Group's rows record none.
  it('hands pi assistant messages its max-token clamp can read', async () => {
    const rows = [
      makeMessage({ id: 'a', role: 'user', content: 'first' }),
      makeMessage({ id: 'b', role: 'pm', content: 'second' }),
      makeMessage({ id: 'c', role: 'user', content: 'third' })
    ]
    getMessagesByConversationId.mockResolvedValue(rows)
    getSessionSummary.mockResolvedValue(null)
    const lcm = new PhilharmonicLcm('c1', fakeModel, 'k', {})
    const messages = await lcm.assembleContext()

    const model = { contextWindow: 200_000 } as Model<string>
    expect(
      clampMaxTokensToContext(model, { systemPrompt: 's', messages }, 8192)
    ).toBe(8192)
  })
})

describe('trackAndCompact', () => {
  it('is a no-op when LCM is disabled', async () => {
    const lcm = new PhilharmonicLcm('c1', fakeModel, 'k', { enabled: false })
    await lcm.trackAndCompact()
    expect(getMessagesByConversationId).not.toHaveBeenCalled()
    expect(summarizeMessages).not.toHaveBeenCalled()
  })

  it('does nothing when under threshold', async () => {
    getMessagesByConversationId.mockResolvedValue([
      makeMessage({ id: 'a', content: 'short' })
    ])
    getSessionSummary.mockResolvedValue(null)
    // contextWindow large enough that even the message overhead stays under.
    const lcm = new PhilharmonicLcm('c1', fakeModel, 'k', {
      contextWindow: 100_000,
      contextWindowPercent: 75,
      freshTailSize: 4
    })
    await lcm.trackAndCompact()
    expect(summarizeMessages).not.toHaveBeenCalled()
    expect(upsertSessionSummary).not.toHaveBeenCalled()
  })

  it('compacts when over threshold, keeping the fresh tail', async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeMessage({
        id: `m${i}`,
        content: 'x'.repeat(200)
      })
    )
    getMessagesByConversationId.mockResolvedValue(rows)
    getSessionSummary.mockResolvedValue(null)
    summarizeMessages.mockResolvedValue('rolled-up summary')
    upsertSessionSummary.mockResolvedValue({})

    // Tiny window so the threshold (75% of 1000 = 750) is easily exceeded.
    const lcm = new PhilharmonicLcm('c1', fakeModel, 'k', {
      contextWindow: 1000,
      contextWindowPercent: 75,
      freshTailSize: 5
    })
    await lcm.trackAndCompact()

    expect(summarizeMessages).toHaveBeenCalledTimes(1)
    const args = summarizeMessages.mock.calls[0][0]
    // Absorb everything older than the last 5.
    expect(args.messages).toHaveLength(15)
    expect(args.messages[args.messages.length - 1].id).toBe('m14')

    const upsertArgs = upsertSessionSummary.mock.calls[0][0]
    expect(upsertArgs.coversThroughMessageId).toBe('m14')
    expect(upsertArgs.messageCount).toBe(15)
    expect(upsertArgs.content).toBe('rolled-up summary')
  })

  it('swallows LLM errors so the next turn can proceed', async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeMessage({ id: `m${i}`, content: 'x'.repeat(200) })
    )
    getMessagesByConversationId.mockResolvedValue(rows)
    getSessionSummary.mockResolvedValue(null)
    summarizeMessages.mockRejectedValue(new Error('LLM blew up'))

    const lcm = new PhilharmonicLcm('c1', fakeModel, 'k', {
      contextWindow: 1000,
      contextWindowPercent: 75,
      freshTailSize: 5
    })
    await expect(lcm.trackAndCompact()).resolves.toBeUndefined()
    expect(upsertSessionSummary).not.toHaveBeenCalled()
  })
})
