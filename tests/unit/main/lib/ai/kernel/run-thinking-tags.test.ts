import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall
} from '@earendil-works/pi-ai'
import type { KernelEvent } from '@main/lib/ai/kernel/events'
import { registerFauxProvider } from '@main/lib/ai/kernel/faux'
import { runAgent } from '@main/lib/ai/kernel/run'
import { Type } from 'typebox'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false }
}))

const RUN_ID = '22222222-2222-4222-8222-222222222222'

const itinerary: AgentTool = {
  name: 'map_itinerary',
  label: 'Map',
  description: 'test',
  parameters: Type.Object({ city: Type.String() }),
  execute: async () => ({
    content: [{ type: 'text', text: 'ok' }],
    details: null
  })
}

describe('runAgent — <thinking> spans in the text stream', () => {
  it('streams and persists the span as a thinking block, never as text', async () => {
    // Small chunks, so the tags are cut across deltas.
    const faux = registerFauxProvider({ tokenSize: { min: 1, max: 2 } })
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxText(
            '<thinking>国庆假期，北京，避开热门景点。用 map_itinerary 展示。</thinking>\n\n我来规划。'
          ),
          fauxToolCall('map_itinerary', { city: '北京' }, { id: 'call_1' })
        ],
        { stopReason: 'toolUse' }
      ),
      fauxAssistantMessage([fauxText('Done.')])
    ])

    const events: KernelEvent[] = []
    for await (const e of runAgent({
      chatId: 'c',
      userMessage: {
        id: RUN_ID,
        runId: RUN_ID,
        role: 'user',
        content: 'plan',
        timestamp: 1
      },
      systemPrompt: 'sys',
      contextMessages: [],
      tools: [itinerary],
      model: faux.getModel(),
      apiKey: 'k'
    })) {
      events.push(e)
    }

    const updates = events.filter((e) => e.type === 'message_update')
    expect(updates.length).toBeGreaterThan(3)
    for (const u of updates) {
      for (const block of u.message.content) {
        if (block.type === 'text') expect(block.text).not.toContain('<')
      }
    }

    const end = events.find((e) => e.type === 'run_end')!
    const first = end.messages[0]
    expect(first.role).toBe('assistant')
    expect(first.content).toEqual([
      {
        type: 'thinking',
        thinking: '国庆假期，北京，避开热门景点。用 map_itinerary 展示。'
      },
      { type: 'text', text: '我来规划。' },
      expect.objectContaining({ type: 'toolCall', name: 'map_itinerary' })
    ])
  })
})
