// The chat's prompt teaches the two blocks and the answer that comes back;
// no other prompt does.
import {
  askBlockSchema,
  confirmBlockSchema,
  stepsBlockSchema,
  stockBlockSchema
} from '@actovia/shared/types/interactive'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))
vi.mock('@main/lib/logger', () => ({ logger }))
vi.mock('@main/lib/ai/memory/manager', () => ({
  callLlm: vi.fn(),
  loadRelevantMemories: vi.fn(),
  parseJsonFromResponse: vi.fn()
}))
vi.mock('@main/lib/ai/utils/model-util', () => ({
  getModelFromProvider: vi.fn()
}))
vi.mock('@main/lib/db/memory-queries', () => ({ createMemory: vi.fn() }))

const {
  ASK_EXAMPLE,
  CONFIRM_EXAMPLE,
  INTERACTIVE_BLOCKS_PROMPT,
  STEPS_EXAMPLE,
  STOCK_EXAMPLE
} = await import('@main/lib/ai/interactive-blocks-prompt')
const {
  deepResearchBootPrompt,
  deepResearchSystemPrompt,
  getSystemPrompt,
  titleGenerationPrompt
} = await import('@main/lib/ai/prompts')
const { HEALTH_PERIOD_REPORT_SYSTEM, HEALTH_SUMMARY_SYSTEM } =
  await import('@main/lib/server/routes/health')

describe('the interactive blocks section', () => {
  it('is in the chat prompt, with both blocks and the answer fence', () => {
    const prompt = getSystemPrompt({})
    expect(prompt).toContain(INTERACTIVE_BLOCKS_PROMPT)
    expect(prompt).toContain(
      `\`\`\`actovia-ask\n${JSON.stringify(ASK_EXAMPLE)}\n\`\`\``
    )
    expect(prompt).toContain(
      `\`\`\`actovia-confirm\n${JSON.stringify(CONFIRM_EXAMPLE)}\n\`\`\``
    )
    expect(prompt).toContain(
      `\`\`\`actovia-steps\n${JSON.stringify(STEPS_EXAMPLE)}\n\`\`\``
    )
    expect(prompt).toContain(
      `\`\`\`actovia-stock\n${JSON.stringify(STOCK_EXAMPLE)}\n\`\`\``
    )
    expect(prompt).toContain('[Marie Curie](entity:Marie_Curie)')
    expect(prompt).toContain('```actovia-answer')
    // Before the response format, after the citations.
    expect(prompt.indexOf('<interactive_blocks>')).toBeGreaterThan(
      prompt.indexOf('</citation_rules>')
    )
    expect(prompt.indexOf('</interactive_blocks>')).toBeLessThan(
      prompt.indexOf('<response_format>')
    )
  })

  it('shows examples the clients draw', () => {
    expect(askBlockSchema.safeParse(ASK_EXAMPLE).success).toBe(true)
    expect(confirmBlockSchema.safeParse(CONFIRM_EXAMPLE).success).toBe(true)
    expect(stepsBlockSchema.safeParse(STEPS_EXAMPLE).success).toBe(true)
    expect(stockBlockSchema.safeParse(STOCK_EXAMPLE).success).toBe(true)
  })

  it('asks for a confirmation only where the prompt already stops: a hard stop or outside this machine', () => {
    // The tool rules say "use tools without asking"; inside the workspace a
    // write is not a confirmation.
    expect(INTERACTIVE_BLOCKS_PROMPT).not.toContain('writing or deleting files')
    expect(INTERACTIVE_BLOCKS_PROMPT).toContain('hard stop (listed above)')
    expect(INTERACTIVE_BLOCKS_PROMPT).toContain(
      'Inside your workspace act freely: no confirmation.'
    )
  })

  it("reads an answer by the message's text: run memory is a part of its own", () => {
    expect(INTERACTIVE_BLOCKS_PROMPT).toContain(
      'A user message whose text opens with ```actovia-answer'
    )
  })

  it('tells the model where a picture may come from, and which ranges exist', () => {
    expect(INTERACTIVE_BLOCKS_PROMPT).toContain('never an original image')
    expect(INTERACTIVE_BLOCKS_PROMPT).toContain('1D, 1M, 3M, 12M, 60M, ALL')
    expect(INTERACTIVE_BLOCKS_PROMPT).toContain('at most five a reply')
  })

  it('names only symbols the TradingView embed draws, and the stand-ins for the indexes it refuses', () => {
    // Measured 2026-10-22: SP:SPX, NASDAQ:NDX, DJ:DJI, TVC:*, CBOE:SPX and
    // TSE:7203 load "This symbol is only available on TradingView".
    expect(INTERACTIVE_BLOCKS_PROMPT).not.toContain('TSE:7203')
    expect(INTERACTIVE_BLOCKS_PROMPT).toContain('FOREXCOM:SPXUSD')
    expect(INTERACTIVE_BLOCKS_PROMPT).toContain('FOREXCOM:NSXUSD')
    expect(INTERACTIVE_BLOCKS_PROMPT).toContain('FOREXCOM:DJI')
    expect(INTERACTIVE_BLOCKS_PROMPT).toMatch(
      /refuses index symbols \(SP:SPX, NASDAQ:NDX/u
    )
  })

  it('stays short: every chat turn reads it', () => {
    expect(INTERACTIVE_BLOCKS_PROMPT.split('\n').length).toBeLessThanOrEqual(70)
  })

  it('is in no other prompt', () => {
    for (const other of [
      deepResearchBootPrompt,
      deepResearchSystemPrompt,
      titleGenerationPrompt,
      HEALTH_SUMMARY_SYSTEM,
      HEALTH_PERIOD_REPORT_SYSTEM
    ]) {
      expect(other).not.toContain('actovia-ask')
      expect(other).not.toContain('actovia-confirm')
      expect(other).not.toContain('actovia-steps')
      expect(other).not.toContain('actovia-stock')
      expect(other).not.toContain('(entity:')
    }
  })
})
