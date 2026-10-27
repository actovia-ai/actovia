import type { Message } from '@earendil-works/pi-ai'
import {
  IMAGE_TOKEN_ALLOWANCE,
  estimateTokens
} from '@main/lib/ai/context-management/token-counter'
import { measureContext, scaleSnapshot } from '@main/lib/chat/context-snapshot'
import { describe, expect, it } from 'vitest'

const user = (text: string): Message =>
  ({ role: 'user', content: [{ type: 'text', text }], timestamp: 0 }) as Message

const tool = (name: string, description: string) =>
  ({
    name,
    label: name,
    description,
    parameters: { type: 'object', properties: { q: { type: 'string' } } },
    execute: async () => ({ content: [], details: undefined })
  }) as never

const base = {
  systemPrompt: 'You are Actovia.',
  skillsIndex: '',
  mcpDirectory: '',
  tools: [],
  memoryTexts: [],
  messages: [],
  kinds: []
}

describe('measureContext', () => {
  it('takes skills and the MCP directory out of the system prompt', () => {
    const skillsIndex = 's'.repeat(1400) // 400 tokens
    const mcpDirectory = 'm'.repeat(700) // 200 tokens
    const prompt = `You are Actovia.\n${skillsIndex}\n${mcpDirectory}`
    const parts = measureContext({
      ...base,
      systemPrompt: prompt,
      skillsIndex,
      mcpDirectory,
      tools: [
        tool('list_mcp_tools', 'List MCP tools'),
        tool('weather', 'Weather')
      ]
    })

    expect(parts.skills).toBe(400)
    expect(parts.mcp).toBeGreaterThan(200)
    expect(parts.system).toBe(
      estimateTokens(prompt) - 400 - estimateTokens(mcpDirectory)
    )
    expect(parts.tools).toBeGreaterThan(0)
  })

  it('reads zero for what a run does not carry', () => {
    const parts = measureContext({
      ...base,
      messages: [user('hi')],
      kinds: ['message']
    })
    expect(parts).toMatchObject({
      skills: 0,
      mcp: 0,
      memory: 0,
      summaries: 0,
      tools: 0
    })
    expect(parts.messages).toBeGreaterThan(0)
  })

  it('counts summaries apart and memory out of the messages that carry it', () => {
    const memory = '<user_memory>likes rain</user_memory>'
    const parts = measureContext({
      ...base,
      memoryTexts: [memory],
      messages: [user('<summary>earlier</summary>'), user(`${memory}\nhello`)],
      kinds: ['summary', 'message']
    })
    expect(parts.summaries).toBeGreaterThan(0)
    expect(parts.memory).toBe(estimateTokens(memory))
  })

  it('counts a picture as a fixed allowance, not its base64', () => {
    const data = 'A'.repeat(3 * 1024 * 1024)
    const withImage = {
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image', data, mimeType: 'image/png' }
      ],
      timestamp: 0
    } as Message
    const parts = measureContext({
      ...base,
      messages: [withImage],
      kinds: ['message']
    })
    expect(parts.messages).toBeGreaterThanOrEqual(IMAGE_TOKEN_ALLOWANCE)
    expect(parts.messages).toBeLessThan(IMAGE_TOKEN_ALLOWANCE + 200)
  })
})

describe('scaleSnapshot', () => {
  const parts = {
    system: 300,
    skills: 0,
    mcp: 0,
    tools: 200,
    memory: 0,
    summaries: 100,
    messages: 400
  }

  it("scales every part to the provider's input", () => {
    const out = scaleSnapshot(parts, 2000)
    expect(out.total).toBe(2000)
    expect(out.estimated).toBe(false)
    expect(out.parts.map((p) => p.key)).toEqual([
      'system',
      'skills',
      'mcp',
      'tools',
      'memory',
      'summaries',
      'messages'
    ])
    expect(out.parts.find((p) => p.key === 'system')?.tokens).toBe(600)
    expect(out.parts.reduce((n, p) => n + p.tokens, 0)).toBe(2000)
  })

  it('puts the rounding remainder on messages', () => {
    const out = scaleSnapshot({ ...parts, skills: 1, mcp: 1, memory: 1 }, 1001)
    expect(out.parts.reduce((n, p) => n + p.tokens, 0)).toBe(1001)
  })

  it('keeps the estimate when the provider reported nothing', () => {
    for (const real of [null, 0]) {
      const out = scaleSnapshot(parts, real)
      expect(out.estimated).toBe(true)
      expect(out.total).toBe(1000)
      expect(out.parts.find((p) => p.key === 'messages')?.tokens).toBe(400)
    }
  })
})
