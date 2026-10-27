import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import {
  CONTEXT_PART_KEYS,
  type ChatContextSnapshot,
  type ContextPartKey
} from '@actovia/shared/types/chat-context'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Message } from '@earendil-works/pi-ai'

import type { ContextMessageKind } from '../ai/context-management/context-assembler'
import {
  estimateContentTokensForView,
  estimateJsonTokens,
  estimateTokens
} from '../ai/context-management/token-counter'

export type ContextParts = Record<ContextPartKey, number>

const TOOLBOX = new Set<string>([
  TOOL_NAMES.listMcpTools,
  TOOL_NAMES.callMcpTool
])

const toolTokens = (tools: AgentTool[]) =>
  tools.reduce(
    (n, t) =>
      n +
      estimateJsonTokens({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }),
    0
  )

/**
 * Each part of a request as the chat route holds it before it joins them
 * (spec 2026-10-27 §2): the skills index and the MCP directory are taken
 * out of the system prompt they sit in, and the memory blocks out of the
 * messages they were put before.
 */
export function measureContext(input: {
  systemPrompt: string
  skillsIndex: string
  mcpDirectory: string
  tools: AgentTool[]
  memoryTexts: string[]
  messages: Message[]
  kinds: ContextMessageKind[]
}): ContextParts {
  const skills = input.skillsIndex ? estimateTokens(input.skillsIndex) : 0
  const directory = input.mcpDirectory ? estimateTokens(input.mcpDirectory) : 0
  const memory = input.memoryTexts.reduce(
    (n, text) => n + (text ? estimateTokens(text) : 0),
    0
  )
  let summaries = 0
  let messages = 0
  input.messages.forEach((m, i) => {
    const tokens = estimateContentTokensForView(m.content)
    if (input.kinds[i] === 'summary') summaries += tokens
    else messages += tokens
  })
  return {
    system: Math.max(
      0,
      estimateTokens(input.systemPrompt) - skills - directory
    ),
    skills,
    mcp: directory + toolTokens(input.tools.filter((t) => TOOLBOX.has(t.name))),
    tools: toolTokens(input.tools.filter((t) => !TOOLBOX.has(t.name))),
    memory,
    summaries,
    messages: Math.max(0, messages - memory)
  }
}

/**
 * The parts scaled to the provider's real input for the run's first call,
 * when it reported one; the estimates as they are otherwise.
 */
export function scaleSnapshot(
  parts: ContextParts,
  realInput: number | null
): Pick<ChatContextSnapshot, 'parts' | 'total' | 'estimated'> {
  const sum = CONTEXT_PART_KEYS.reduce((n, k) => n + parts[k], 0)
  if (!realInput || realInput <= 0 || sum <= 0) {
    return {
      parts: CONTEXT_PART_KEYS.map((key) => ({ key, tokens: parts[key] })),
      total: sum,
      estimated: true
    }
  }
  const scaled = CONTEXT_PART_KEYS.map((key) => ({
    key,
    tokens: Math.round((parts[key] * realInput) / sum)
  }))
  const remainder = realInput - scaled.reduce((n, p) => n + p.tokens, 0)
  const last = scaled[scaled.length - 1]
  last.tokens = Math.max(0, last.tokens + remainder)
  return { parts: scaled, total: realInput, estimated: false }
}
