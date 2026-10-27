// pi keeps only the message of whatever is thrown into it — from the
// kernel's listener, from `convertToLlm`, from `beforeToolCall` — so the
// kernel logs the Error first, once, and lets it go on. What a run yields
// does not change.
import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  Type,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall
} from '@earendil-works/pi-ai'
import type { KernelEvent } from '@main/lib/ai/kernel/events'
import type { RunInput } from '@main/lib/ai/kernel/run'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false }
}))

const error = vi.fn()
vi.mock('@main/lib/logger', () => ({
  logger: { error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

// What each of the kernel's own steps throws, when a test says so.
const thrownBy: {
  listener?: Error
  invariant?: Error
  approval?: Error
} = {}
vi.mock('@actovia/shared/utils/thinking-tags', async (original) => {
  const real =
    await original<typeof import('@actovia/shared/utils/thinking-tags')>()
  return {
    ...real,
    // Runs inside the kernel's listener, on every assistant message.
    splitThinkingTagsInContent: (
      ...args: Parameters<typeof real.splitThinkingTagsInContent>
    ) => {
      if (thrownBy.listener) throw thrownBy.listener
      return real.splitThinkingTagsInContent(...args)
    }
  }
})
vi.mock('@main/lib/ai/kernel/invariant', async (original) => {
  const real = await original<typeof import('@main/lib/ai/kernel/invariant')>()
  return {
    ...real,
    dropBrokenRuns: (...args: Parameters<typeof real.dropBrokenRuns>) => {
      if (thrownBy.invariant) throw thrownBy.invariant
      return real.dropBrokenRuns(...args)
    }
  }
})
vi.mock('@main/lib/ai/kernel/approval', async (original) => {
  const real = await original<typeof import('@main/lib/ai/kernel/approval')>()
  return {
    ...real,
    sensitiveTarget: (...args: Parameters<typeof real.sensitiveTarget>) => {
      if (thrownBy.approval) return Promise.reject(thrownBy.approval)
      return real.sensitiveTarget(...args)
    }
  }
})

const { registerFauxProvider } = await import('@main/lib/ai/kernel/faux')
const { runAgent } = await import('@main/lib/ai/kernel/run')

const weather: AgentTool = {
  name: 'weather',
  label: 'Weather',
  description: 'test',
  parameters: Type.Object({ location: Type.String() }),
  execute: async (_id, { location }) => ({
    content: [{ type: 'text', text: `sunny in ${location}` }],
    details: { location }
  })
}

const CHAT_ID = 'chat-1'
const RUN_ID = '11111111-1111-4111-8111-111111111111'
const TOTAL_TOKENS =
  "Cannot read properties of undefined (reading 'totalTokens')"

function input(model: RunInput['model']): RunInput {
  return {
    chatId: CHAT_ID,
    userMessage: {
      id: RUN_ID,
      runId: RUN_ID,
      role: 'user',
      content: 'hi',
      timestamp: 1
    },
    systemPrompt: 'sys',
    contextMessages: [],
    tools: [weather],
    apiKey: 'k',
    model
  }
}

async function collect(events: AsyncIterable<KernelEvent>) {
  const out: KernelEvent[] = []
  for await (const event of events) out.push(event)
  return out
}

const kernelErrors = () =>
  error.mock.calls.filter(([surface]) => surface === 'kernel') as [
    string,
    string,
    Record<string, unknown>
  ][]

beforeEach(() => {
  error.mockClear()
  delete thrownBy.listener
  delete thrownBy.invariant
  delete thrownBy.approval
})

describe('runAgent — a throw inside the kernel', () => {
  it('logs nothing of its own for a run that works', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('hello')])])
    const events = await collect(runAgent(input(faux.getModel())))
    expect(events.at(-1)!.type).toBe('run_end')
    expect(kernelErrors()).toEqual([])
  })

  it('from the listener: logged once as the Error, with the chat and the run', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('hello')])])
    thrownBy.listener = new TypeError(TOTAL_TOKENS)

    const events = await collect(runAgent(input(faux.getModel())))

    // The run ends the way it did before: the message, as a string.
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['run_end', 'error'])
    )
    const failed = events.find((e) => e.type === 'error')
    expect(failed).toMatchObject({ runId: RUN_ID, error: TOTAL_TOKENS })

    const logged = kernelErrors()
    expect(logged).toHaveLength(1)
    const [, message, detail] = logged[0]
    expect(message).toMatch(/listener/u)
    expect(detail.error).toBe(thrownBy.listener)
    expect(detail).toMatchObject({ chatId: CHAT_ID, runId: RUN_ID })
  })

  it('from convertToLlm: logged once as the Error', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('hello')])])
    thrownBy.invariant = new TypeError(TOTAL_TOKENS)

    const events = await collect(runAgent(input(faux.getModel())))

    expect(events.find((e) => e.type === 'error')).toMatchObject({
      error: TOTAL_TOKENS
    })
    const logged = kernelErrors()
    expect(logged).toHaveLength(1)
    expect(logged[0][1]).toMatch(/convertToLlm/u)
    expect(logged[0][2].error).toBe(thrownBy.invariant)
    expect(logged[0][2]).toMatchObject({ chatId: CHAT_ID, runId: RUN_ID })
  })

  it('from beforeToolCall: logged once, and the call fails as it did', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('weather', { location: 'Oslo' }, { id: 'call_1' })],
        { stopReason: 'toolUse' }
      ),
      fauxAssistantMessage([fauxText('done')])
    ])
    thrownBy.approval = new TypeError(TOTAL_TOKENS)

    const events = await collect(runAgent(input(faux.getModel())))

    const toolEnd = events.find((e) => e.type === 'tool_end')
    expect(toolEnd).toMatchObject({
      message: {
        isError: true,
        content: [{ type: 'text', text: TOTAL_TOKENS }]
      }
    })
    expect(events.at(-1)!.type).toBe('run_end')

    const logged = kernelErrors()
    expect(logged).toHaveLength(1)
    expect(logged[0][1]).toMatch(/beforeToolCall/u)
    expect(logged[0][2].error).toBe(thrownBy.approval)
    expect(logged[0][2]).toMatchObject({
      chatId: CHAT_ID,
      runId: RUN_ID,
      toolName: 'weather'
    })
  })
})
