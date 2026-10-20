import { fauxWeatherTool } from '@main/lib/ai/kernel/faux'
import { bootFauxProviderIfRequested } from '@main/lib/ai/kernel/faux-boot'
import {
  COMPARE_QUESTION,
  compareAnswer
} from '@main/lib/ai/kernel/faux-memory-fixtures'
import { runAgent } from '@main/lib/ai/kernel/run'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// The kernel logs through the main-process logger, which reads Electron's
// `app` at import time.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false }
}))

// The regenerate e2e (`tests/e2e/regenerate-compare.spec.ts`) asks one
// question twice and has to tell the answers apart: the request of a
// regenerate is the request of the first ask, word for word.
describe('the e2e provider answers the comparison question', () => {
  let model: NonNullable<ReturnType<typeof bootFauxProviderIfRequested>>

  beforeAll(() => {
    vi.stubEnv('ACTOVIA_FAUX_PROVIDER', '1')
    model = bootFauxProviderIfRequested()!
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  async function ask(runId: string): Promise<string> {
    let answer = ''
    const events = runAgent({
      chatId: 'c',
      userMessage: {
        id: runId,
        runId,
        role: 'user',
        content: COMPARE_QUESTION,
        timestamp: 1
      },
      systemPrompt: 'sys',
      contextMessages: [],
      tools: [fauxWeatherTool],
      model: model.getModel(),
      apiKey: 'k'
    })
    for await (const event of events) {
      if (event.type !== 'run_end') continue
      const last = event.messages.at(-1)
      if (last?.role !== 'assistant') continue
      for (const block of last.content) {
        if (block.type === 'text') answer += block.text
      }
    }
    return answer
  }

  it('with a new take each time it is asked, and no tool call', async () => {
    expect(await ask('11111111-1111-4111-8111-111111111111')).toBe(
      compareAnswer(1)
    )
    expect(await ask('22222222-2222-4222-8222-222222222222')).toBe(
      compareAnswer(2)
    )
  })
})
