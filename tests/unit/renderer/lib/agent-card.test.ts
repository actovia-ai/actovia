import { describe, expect, it } from 'vitest'

import {
  agentCardFromParts,
  cardStateKey,
  visibleSteps
} from '@/lib/agent-card'

const card = (over: Record<string, unknown> = {}) =>
  ({
    kind: 'agent_card',
    sessionId: 's',
    state: 'working',
    queued: false,
    steps: [],
    prompts: [],
    ...over
  }) as never

describe('agent card helpers', () => {
  it('finds the card among a message’s parts', () => {
    expect(agentCardFromParts([{ kind: 'artifact' }, card()])).toMatchObject({
      sessionId: 's'
    })
    expect(agentCardFromParts([{ kind: 'artifact' }])).toBeUndefined()
    expect(agentCardFromParts(null)).toBeUndefined()
  })

  it('shows the last steps and counts the rest', () => {
    const steps = Array.from({ length: 9 }, (_, i) => ({
      id: `${i}`,
      tool: 'Read',
      summary: `${i}`,
      status: 'ok'
    }))
    const { shown, hidden } = visibleSteps(card({ steps }), 6)
    expect(shown.map((s) => s.id)).toEqual(['3', '4', '5', '6', '7', '8'])
    expect(hidden).toBe(3)
  })

  it('shows every step when there are few', () => {
    const steps = [{ id: 'a', tool: 'Read', summary: '', status: 'ok' }]
    expect(visibleSteps(card({ steps }))).toEqual({ shown: steps, hidden: 0 })
  })

  it('names the state, queued and waiting first', () => {
    expect(cardStateKey(card({ queued: true }))).toBe(
      'agents.card.state.queued'
    )
    expect(cardStateKey(card({ state: 'blocked' }))).toBe(
      'agents.card.state.waiting'
    )
    expect(cardStateKey(card({ state: 'error' }))).toBe(
      'agents.card.state.failed'
    )
    expect(cardStateKey(card({ state: 'stopped' }))).toBe(
      'agents.card.state.stopped'
    )
    expect(cardStateKey(card({ state: 'done' }))).toBe('agents.card.state.done')
  })
})
