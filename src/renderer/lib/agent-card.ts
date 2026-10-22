import type { AgentCard, AgentCardStep } from '@actovia/shared/types/agents'

import { toolLabel } from '@/lib/tool-label'

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

/**
 * A CLI tool's name as a person reads it. An MCP tool comes as
 * `mcp__<server>__<tool>`, the server of a Claude Code plugin as
 * `plugin_<plugin>_<server>`: 'Playwright · Browser Run Code Unsafe', not
 * 'Mcp Plugin Playwright Playwright Browser Run Code Unsafe'.
 */
export function cliToolLabel(tool: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/u.exec(tool)
  if (!mcp) return toolLabel(tool)
  // A plugin whose server has its own name: `playwright_playwright`.
  const server = mcp[1].replace(/^plugin_/u, '').replace(/^(.+)_\1$/u, '$1')
  return `${toolLabel(server)} · ${toolLabel(mcp[2])}`
}

/**
 * A step's summary with the run's folder taken off its paths: `Read
 * src/app.ts`, not the whole absolute path (which the folder chip already
 * names). Display only — an approval still shows the exact path.
 */
export function relativeSummary(summary: string, cwd: string): string {
  const root = cwd.replace(/\/+$/, '')
  if (!root || root === '/') return summary
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // The folder itself (followed by a quote, space or the end) becomes `.`;
  // a path under it loses the folder and its slash.
  return summary
    .replace(new RegExp(`(?<![\\w./-])${escaped}/`, 'g'), '')
    .replace(new RegExp(`(?<![\\w./-])${escaped}(?=$|["'\\s])`, 'g'), '.')
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
