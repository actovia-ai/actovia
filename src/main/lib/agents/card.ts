import { type AgentCard, CLI_NAMES } from '@exodus/shared/types/agents'

import type { AgentEvent } from './driver'

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

export function newCard(
  init: Pick<
    AgentCard,
    | 'sessionId'
    | 'agentId'
    | 'runtime'
    | 'model'
    | 'projectName'
    | 'cwd'
    | 'branch'
  >
): AgentCard {
  return {
    kind: 'agent_card',
    ...init,
    state: 'working',
    steps: [],
    blocks: [],
    pending: '',
    prompts: [],
    notices: [],
    costUsd: null,
    denials: 0,
    error: null,
    continuedInTerminal: false,
    queued: false
  }
}

export function cardText(card: AgentCard): string {
  return [...card.blocks, card.pending].filter((t) => t.trim()).join('\n\n')
}

export function touchedFiles(card: AgentCard): string[] {
  return [
    ...new Set(
      card.steps
        .filter((s) => EDIT_TOOLS.has(s.tool) && s.status === 'ok' && s.summary)
        .map((s) => s.summary)
    )
  ]
}

export function applyAgentEvent(card: AgentCard, e: AgentEvent): AgentCard {
  switch (e.type) {
    case 'init':
      return {
        ...card,
        state: card.prompts.length > 0 ? 'blocked' : 'working',
        error: null,
        queued: false
      }
    case 'text_delta':
      return { ...card, pending: card.pending + e.delta }
    case 'text':
      return { ...card, blocks: [...card.blocks, e.text], pending: '' }
    case 'step_start':
      if (card.steps.some((s) => s.id === e.id)) return card
      return {
        ...card,
        steps: [
          ...card.steps,
          { id: e.id, tool: e.tool, summary: e.summary, status: 'running' }
        ]
      }
    case 'step_end':
      return {
        ...card,
        steps: card.steps.map((s) =>
          s.id === e.id ? { ...s, status: e.isError ? 'error' : 'ok' } : s
        )
      }
    case 'blocked':
      return { ...card, state: 'blocked', prompts: [...card.prompts, e.prompt] }
    case 'answered': {
      const prompts = card.prompts.filter((p) => p.requestId !== e.requestId)
      return {
        ...card,
        prompts,
        state: prompts.length > 0 ? 'blocked' : 'working'
      }
    }
    case 'notice':
      return card.notices.at(-1) === e.text
        ? card
        : { ...card, notices: [...card.notices, e.text] }
    case 'turn_end': {
      const blocks = card.pending.trim()
        ? [...card.blocks, card.pending]
        : card.blocks
      const state = e.interrupted ? 'stopped' : e.ok ? 'done' : 'error'
      return {
        ...card,
        blocks,
        pending: '',
        prompts: [],
        costUsd:
          e.costUsd === null ? card.costUsd : (card.costUsd ?? 0) + e.costUsd,
        denials: card.denials + e.denials,
        state,
        error:
          state === 'error' ? e.text || 'The turn ended with an error.' : null
      }
    }
    case 'quota':
      // Kept by the quota store; the card shows the CLI's notice line only.
      return card
    case 'exit':
      if (card.state !== 'working' && card.state !== 'blocked') return card
      return {
        ...card,
        prompts: [],
        state: e.expected ? 'stopped' : 'error',
        error: e.expected
          ? null
          : e.stderrTail ||
            `${CLI_NAMES[card.runtime]} exited (code ${e.code ?? '?'}).`
      }
  }
}
