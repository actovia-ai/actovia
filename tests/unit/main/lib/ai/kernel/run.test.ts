import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  type Message,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall
} from '@earendil-works/pi-ai'
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options'
import type { KernelEvent } from '@main/lib/ai/kernel/events'
import { registerFauxProvider } from '@main/lib/ai/kernel/faux'
import { runAgent, type RunInput } from '@main/lib/ai/kernel/run'
import { Type } from 'typebox'
import { describe, expect, it, vi } from 'vitest'

// The kernel logs through the main-process logger, which reads Electron's
// `app` at import time.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false }
}))

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

const RUN_ID = '11111111-1111-4111-8111-111111111111'

/**
 * Each test registers its own faux provider (registration replaces the one
 * before it in the collection, so it must be the last thing registered) and
 * passes its model in.
 */
function input(over: Partial<RunInput> & Pick<RunInput, 'model'>): RunInput {
  return {
    chatId: 'c',
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
    ...over
  }
}

async function collect(it: AsyncIterable<KernelEvent>) {
  const out: KernelEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

const toolCallStep = () =>
  fauxAssistantMessage(
    [fauxToolCall('weather', { location: 'Oslo' }, { id: 'call_1' })],
    { stopReason: 'toolUse' }
  )

describe('runAgent', () => {
  it('a plain answer: message_update*, message_end, run_end — all with runId', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('hello')])])

    const events = await collect(runAgent(input({ model: faux.getModel() })))

    expect(events.every((e) => e.runId === RUN_ID)).toBe(true)
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['message_update', 'message_end', 'run_end'])
    )
    const end = events.at(-1)!
    expect(end.type).toBe('run_end')
    if (end.type !== 'run_end') return
    expect(end.messages.map((m) => m.role)).toEqual(['assistant'])
    expect(end.messages[0]).toMatchObject({
      runId: RUN_ID,
      content: [{ type: 'text', text: 'hello' }],
      stopReason: 'stop'
    })
    expect(end.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('a tool step: tool_start → tool_end, then the final text, one assistant message per step', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([
      toolCallStep(),
      fauxAssistantMessage([fauxText('It is sunny in Oslo.')])
    ])

    const events = await collect(runAgent(input({ model: faux.getModel() })))

    const types = events.map((e) => e.type)
    expect(types.indexOf('tool_start')).toBeGreaterThan(-1)
    expect(types.indexOf('tool_start')).toBeLessThan(types.indexOf('tool_end'))
    const start = events.find((e) => e.type === 'tool_start')!
    const toolEnd = events.find((e) => e.type === 'tool_end')!
    if (start.type !== 'tool_start' || toolEnd.type !== 'tool_end') return
    expect(toolEnd.message).toMatchObject({
      id: start.messageId,
      role: 'toolResult',
      toolCallId: 'call_1',
      toolName: 'weather',
      runId: RUN_ID,
      isError: false,
      content: [{ type: 'text', text: 'sunny in Oslo' }],
      details: { location: 'Oslo' }
    })
    const end = events.at(-1)!
    if (end.type !== 'run_end') throw new Error('no run_end')
    expect(end.messages.map((m) => m.role)).toEqual([
      'assistant',
      'toolResult',
      'assistant'
    ])
    // Each assistant step is its own message with its own id.
    const ids = end.messages.map((m) => m.id)
    expect(new Set(ids).size).toBe(3)
  })

  it('a disabled tool is blocked before it runs and the model is told why', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([toolCallStep(), fauxAssistantMessage([fauxText('ok')])])

    const events = await collect(
      runAgent(
        input({ model: faux.getModel(), disabledTools: new Set(['weather']) })
      )
    )

    const toolEnd = events.find((e) => e.type === 'tool_end')!
    if (toolEnd.type !== 'tool_end') throw new Error('no tool_end')
    expect(toolEnd.message.isError).toBe(true)
    expect(toolEnd.message.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringMatching(/disabled in settings/iu)
    })
  })

  it('a provider error ends the run with an error event after the steps that completed', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([
      toolCallStep(),
      fauxAssistantMessage([], {
        stopReason: 'error',
        errorMessage: 'HTTP 429: rate limited'
      })
    ])

    const events = await collect(runAgent(input({ model: faux.getModel() })))

    const types = events.map((e) => e.type)
    expect(types).toContain('tool_end')
    expect(types.at(-1)).toBe('error')
    const err = events.at(-1)!
    if (err.type !== 'error') throw new Error('no error')
    expect(err.error).toMatch(/429/u)
    // run_end precedes error so the recorder persists the completed steps.
    expect(types.indexOf('run_end')).toBeLessThan(types.indexOf('error'))
    const end = events.find((e) => e.type === 'run_end')!
    if (end.type !== 'run_end') throw new Error('no run_end')
    expect(end.messages.map((m) => m.role)).toEqual(['assistant', 'toolResult'])
  })

  // The zero-token "dead turn" (empty content, no usage — an error) cannot
  // be scripted: the faux provider always counts prompt tokens. That branch
  // is `isEmptyAssistantTurn`, covered in chat-errors.test.ts.
  it('an empty aborted answer (Stop before the first token) is just the end', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([fauxAssistantMessage([], { stopReason: 'aborted' })])
    const aborted = await collect(runAgent(input({ model: faux.getModel() })))
    const end = aborted.at(-1)!
    expect(end.type).toBe('run_end')
    if (end.type !== 'run_end') return
    expect(end.messages).toEqual([])
  })

  it('a partial answer cut off by Stop is kept, marked aborted', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxText('half an answer')], {
        stopReason: 'aborted'
      })
    ])
    const events = await collect(runAgent(input({ model: faux.getModel() })))
    const end = events.at(-1)!
    if (end.type !== 'run_end') throw new Error('no run_end')
    expect(end.messages).toHaveLength(1)
    expect(end.messages[0]).toMatchObject({
      role: 'assistant',
      stopReason: 'aborted',
      content: [{ type: 'text', text: 'half an answer' }]
    })
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('aborting the signal cancels the run', async () => {
    const faux = registerFauxProvider({ tokensPerSecond: 20 })
    faux.setResponses([
      toolCallStep(),
      fauxAssistantMessage([
        fauxText('a long answer that streams slowly over a great many tokens')
      ])
    ])
    const controller = new AbortController()
    const events: KernelEvent[] = []
    for await (const e of runAgent(
      input({ model: faux.getModel(), signal: controller.signal })
    )) {
      events.push(e)
      if (e.type === 'tool_end') controller.abort()
    }
    const end = events.find((e) => e.type === 'run_end')!
    if (end.type !== 'run_end') throw new Error('no run_end')
    // The tool step completed and is kept; the answer after it was cut.
    expect(end.messages.slice(0, 2).map((m) => m.role)).toEqual([
      'assistant',
      'toolResult'
    ])
    const last = end.messages.at(-1)!
    if (last.role === 'assistant' && end.messages.length === 3) {
      expect(last.stopReason).toBe('aborted')
    }
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  // A chat saves an attachment as the data URL the renderer shows; the
  // provider wants bare base64 (Anthropic: 400 "invalid base64 data").
  it('convertToLlm sends a stored data-URL image as bare base64', async () => {
    const faux = registerFauxProvider()
    let seen: unknown
    faux.setResponses([
      (ctx) => {
        seen = ctx.messages.flatMap((m) =>
          typeof m.content === 'string'
            ? []
            : m.content.filter((p) => p.type === 'image')
        )
        return fauxAssistantMessage([fauxText('ok')])
      }
    ])
    await collect(
      runAgent(
        input({
          model: faux.getModel(),
          contextMessages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  data: 'data:image/png;base64,AAAA',
                  mimeType: 'image/png'
                }
              ],
              timestamp: 0
            }
          ],
          userMessage: {
            id: RUN_ID,
            runId: RUN_ID,
            role: 'user',
            content: [
              {
                type: 'image',
                data: 'data:image/jpeg;base64,BBBB',
                mimeType: 'image/jpeg'
              }
            ],
            timestamp: 1
          }
        })
      )
    )
    expect(seen).toEqual([
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      { type: 'image', data: 'BBBB', mimeType: 'image/jpeg' }
    ])
  })

  // OpenAI routes a conversation's requests to one prompt cache by this key
  // (pi sends it as prompt_cache_key); without it, the cache is a lottery.
  it('tells the provider which conversation this is', async () => {
    const faux = registerFauxProvider()
    let sessionId: string | undefined
    faux.setResponses([
      (_ctx, options) => {
        sessionId = options?.sessionId
        return fauxAssistantMessage([fauxText('ok')])
      }
    ])
    await collect(
      runAgent(input({ model: faux.getModel(), chatId: 'chat-42' }))
    )
    expect(sessionId).toBe('chat-42')
  })

  it('convertToLlm drops a broken run from the context instead of sending it', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([
      (ctx) =>
        fauxAssistantMessage([
          // The conversation rows only — pi 1.0 adds the system message.
          fauxText(
            `saw ${ctx.messages.filter((m) => m.role !== 'system').length} messages`
          )
        ])
    ])
    const events = await collect(
      runAgent(
        input({
          model: faux.getModel(),
          contextMessages: [
            // An orphan tool result before any user message: not a run.
            {
              role: 'toolResult',
              toolCallId: 'ghost',
              toolName: 'weather',
              content: [],
              isError: false,
              timestamp: 0
            },
            { role: 'user', content: 'earlier', timestamp: 0 },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'earlier answer' }],
              api: 'a',
              provider: 'p',
              model: 'm',
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: 0
                }
              },
              stopReason: 'stop',
              timestamp: 0
            }
          ]
        })
      )
    )
    const end = events.find((e) => e.type === 'run_end')!
    if (end.type !== 'run_end') throw new Error('no run_end')
    // earlier user + earlier answer + this prompt = 3; the orphan is gone.
    expect(end.messages[0].content).toEqual([
      { type: 'text', text: 'saw 3 messages' }
    ])
  })

  // With LCM off the history is what the client posted. Every real provider
  // runs pi's max-token clamp over the context before it sends anything, and
  // the clamp reads `usage` off each assistant message.
  it('convertToLlm gives an assistant message that came without usage one pi can read', async () => {
    const faux = registerFauxProvider()
    const model = faux.getModel()
    faux.setResponses([
      (ctx) =>
        fauxAssistantMessage([
          fauxText(
            `clamped to ${clampMaxTokensToContext({ ...model, contextWindow: 200_000 }, ctx, 8192)}`
          )
        ])
    ])
    const events = await collect(
      runAgent(
        input({
          model,
          contextMessages: [
            { role: 'user', content: 'earlier', timestamp: 0 },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'earlier answer' }],
              timestamp: 0
            } as unknown as Message
          ]
        })
      )
    )
    expect(events.filter((e) => e.type === 'error')).toEqual([])
    const end = events.find((e) => e.type === 'run_end')!
    if (end.type !== 'run_end') throw new Error('no run_end')
    expect(end.messages[0].content).toEqual([
      { type: 'text', text: 'clamped to 8192' }
    ])
  })
})
