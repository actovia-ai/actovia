import type { AgentCard, AgentCardStep } from '@exodus/shared/types/agents'

/** The agent card among a message's persisted `parts`, if it has one. */
export function agentCardFromParts(
  parts: unknown[] | null | undefined
): AgentCard | undefined {
  return (parts ?? []).find(
    (p): p is AgentCard =>
      typeof p === 'object' &&
      p !== null &&
      (p as { kind?: unknown }).kind === 'agent_card'
  )
}

/** The last `max` steps, and how many earlier ones are folded away. */
export function visibleSteps(
  card: AgentCard,
  max = 6
): { shown: AgentCardStep[]; hidden: number } {
  const hidden = Math.max(0, card.steps.length - max)
  return { shown: card.steps.slice(hidden), hidden }
}

type StateWord =
  | 'queued'
  | 'working'
  | 'waiting'
  | 'done'
  | 'stopped'
  | 'failed'

const STATE: Record<AgentCard['state'], StateWord> = {
  working: 'working',
  blocked: 'waiting',
  done: 'done',
  stopped: 'stopped',
  error: 'failed'
}

/** The i18n key (philharmonic namespace) naming the card's state. */
export const cardStateKey = (
  card: AgentCard
): `agents.card.state.${StateWord}` =>
  `agents.card.state.${card.queued ? 'queued' : STATE[card.state]}`
