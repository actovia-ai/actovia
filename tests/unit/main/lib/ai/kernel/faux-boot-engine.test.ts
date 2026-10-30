import {
  bootFauxProviderIfRequested,
  FAUX_PROMPT_MARKERS
} from '@main/lib/ai/kernel/faux-boot'
import {
  MEMORY_CORRECTION_RESULT,
  MEMORY_CORRECTION_SEED
} from '@main/lib/ai/kernel/faux-memory-fixtures'
import { completeSimple } from '@main/lib/ai/utils/complete'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false }
}))

// The memory e2e (`tests/e2e/chat-memory-edit.spec.ts`) depends on the faux
// provider answering the memory engine's one-shot calls by their system
// prompt. Since pi 1.0 a provider is handed the prompt as the transcript's
// leading system message, never as `systemPrompt`; reading the latter left
// every engine call unrecognised — an empty answer, so `update_memory`
// failed ("Couldn't update memory") and the read filter chose nothing.
describe('the e2e provider answers the memory engine', () => {
  let handle: NonNullable<ReturnType<typeof bootFauxProviderIfRequested>>
  const id = '11111111-1111-4111-8111-111111111111'

  beforeAll(() => {
    vi.stubEnv('ACTOVIA_FAUX_PROVIDER', '1')
    handle = bootFauxProviderIfRequested()!
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  async function ask(systemPrompt: string, text: string): Promise<string> {
    const result = await completeSimple(
      handle.getModel(),
      {
        systemPrompt,
        messages: [
          { role: 'user', content: [{ type: 'text', text }], timestamp: 1 }
        ]
      },
      { apiKey: 'k' }
    )
    return result.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
  }

  it('turns an instruction into an update of the named entry', async () => {
    const answer = await ask(
      `${FAUX_PROMPT_MARKERS.instruction}. Reply with JSON.`,
      `[${id}] (profile) Home OS: Uses macOS\n\nInstruction: I moved to Linux.`
    )
    expect(JSON.parse(answer)).toEqual({
      operations: [
        {
          op: 'update',
          id,
          section: MEMORY_CORRECTION_SEED.section,
          key: MEMORY_CORRECTION_RESULT.key,
          summary: MEMORY_CORRECTION_RESULT.summary,
          details: MEMORY_CORRECTION_RESULT.details
        }
      ]
    })
  })

  it('has the read filter select the entries it was shown', async () => {
    const answer = await ask(
      `${FAUX_PROMPT_MARKERS.readFilter} to the message.`,
      `Memories:\n- id: ${id} Classical Music\n\nMessage: What music do I like?`
    )
    expect(JSON.parse(answer)).toEqual({ selectedMemoryIds: [id] })
  })
})
