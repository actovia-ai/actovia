import type { AgentCard, AgentCardStep } from '@actovia/shared/types/agents'

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

/** The live map after an `agent_card` event for `messageId`. */
export const recordAgentCard = (
  live: Readonly<Record<string, AgentCard>>,
  messageId: string,
  card: AgentCard
): Record<string, AgentCard> => ({ ...live, [messageId]: card })

/**
 * A message's card: the latest one the stream sent for that message, else the
 * one it carries. Keyed by message, never by session — an employee's steps
 * resume one session, and each step's message keeps its own card.
 */
export const messageCard = (
  live: Readonly<Record<string, AgentCard>>,
  messageId: string,
  own?: AgentCard
): AgentCard | undefined => live[messageId] ?? own

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
