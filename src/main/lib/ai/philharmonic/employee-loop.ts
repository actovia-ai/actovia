// src/main/lib/ai/philharmonic/employee-loop.ts
import type { PhilharmonicSseEvent } from '@actovia/shared/types/philharmonic'
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import { agentLoop } from '@earendil-works/pi-agent-core'
import type { Message, Usage } from '@earendil-works/pi-ai'
import { v4 as uuidV4 } from 'uuid'

import {
  createTaskExecutionEvent,
  getAgentMemories,
  updateTaskExecution
} from '../../db/philharmonic-queries'
import { getSettings } from '../../db/queries'
import type { Agent, Team } from '../../db/schema'
import { getTeamById } from '../../db/team-queries'
import { streamFn } from '../kernel/models'
import { getMcpTools, getMcpToolsByNames } from '../mcp'
import {
  getActiveSkillsContent,
  getSkillsContentBySlugs
} from '../skills/skills-manager'
import { bindCallingTools } from '../utils/chat-message-util'
import { calculateCost } from '../utils/cost'
import { resolveEmployeeModel } from '../utils/employee-model'
import { groupBeforeToolCall } from './sensitive-guard'

export type SseEmitter = (event: PhilharmonicSseEvent) => void

export interface RunEmployeeLoopArgs {
  agent: Agent
  instructions: string
  executionId: string
  conversationId: string
  emit: SseEmitter
  /** Extra tools (e.g. none for employees in v1). */
  extraTools?: AgentTool[]
  signal?: AbortSignal
}

function buildEmployeeSystemPrompt(agent: Agent, team: Team | null): string {
  const parts = [`You are "${agent.name}", a virtual employee on a team.`]
  if (team) parts.push(`Team: ${team.name}`)
  if (agent.description) parts.push(`Role: ${agent.description}`)
  // Team's systemPrompt applies to every member; the agent's own prompt layers on top.
  if (team?.systemPrompt) parts.push(team.systemPrompt)
  if (agent.systemPrompt) parts.push(agent.systemPrompt)
  parts.push(
    '\nYou were given a task by the team PM. Use your tools to complete it.',
    'When finished, give a clear, self-contained summary of what you did and the result.'
  )
  return parts.join('\n\n')
}

/**
 * Run a single employee's agent loop. Tools/skills/MCP come from the AGENT
 * (no department). Streams bubbles into the conversation, persists usage on the
 * execution row, and returns the final text output.
 */
export async function runEmployeeLoop(
  args: RunEmployeeLoopArgs
): Promise<string> {
  const { agent, instructions, executionId, conversationId, emit, signal } =
    args
  const setting = await getSettings()
  const { model, apiKey } = resolveEmployeeModel(agent, setting)

  const mcpNames = (agent.mcpServerNames as string[] | null) ?? []
  const mcpTools =
    mcpNames.length > 0
      ? await getMcpToolsByNames(mcpNames)
      : await getMcpTools()
  const allTools = bindCallingTools({
    advancedTools: [],
    setting,
    mcpTools,
    groupId: conversationId
  })

  const allowList = (agent.toolAllowList as string[] | null) ?? []
  let tools =
    allowList.length > 0
      ? allTools.filter((t) => allowList.includes(t.name))
      : allTools
  if (args.extraTools?.length) tools = [...tools, ...args.extraTools]

  const skillSlugs = (agent.skillSlugs as string[] | null) ?? []
  const skillsContent =
    skillSlugs.length > 0
      ? await getSkillsContentBySlugs(skillSlugs)
      : await getActiveSkillsContent()
  // Memories are scoped per Group (P1-4): an employee's experience in one
  // conversation never bleeds into another's prompt.
  const memories = await getAgentMemories(agent.id, conversationId)
  const memoryBlock =
    memories.length > 0
      ? '\n\nPast experience:\n' +
        memories
          .slice(0, 5)
          .map((m) => `- ${JSON.stringify(m.value)}`)
          .join('\n')
      : ''
  const team = agent.teamId ? ((await getTeamById(agent.teamId)) ?? null) : null
  const systemPrompt =
    buildEmployeeSystemPrompt(agent, team) + memoryBlock + skillsContent

  const userMessage: Message = {
    role: 'user',
    content: [{ type: 'text', text: instructions }],
    timestamp: Date.now()
  }

  const messageId = uuidV4()
  emit({
    type: 'message_start',
    conversationId,
    messageId,
    role: 'employee',
    agentId: agent.id
  })

  let finalOutput = ''
  let totalInput = 0
  let totalOutput = 0
  let lastUsage: Usage | undefined

  const stream = agentLoop(
    [userMessage as AgentMessage],
    // pi 1.0: the system prompt and the tool declarations lead the transcript
    // as a system message; `tools` stays the executable set.
    {
      messages: [
        {
          role: 'system',
          content: systemPrompt,
          toolsAdded: tools,
          timestamp: Date.now()
        }
      ],
      tools
    },
    {
      model,
      apiKey,
      convertToLlm: (msgs: AgentMessage[]): Message[] =>
        // `system` too: since pi 1.0 the leading system message carries the
        // prompt and the tool declarations — dropping it would send the
        // model a bare conversation with no tools.
        msgs.filter(
          (m): m is Message =>
            (m as Message).role === 'system' ||
            (m as Message).role === 'user' ||
            (m as Message).role === 'assistant' ||
            (m as Message).role === 'toolResult'
        ),
      // Secrets outside Actovia: refused in a Group run (sensitive-guard.ts).
      beforeToolCall: groupBeforeToolCall(conversationId)
    },
    signal,
    streamFn
  )

  try {
    for await (const event of stream) {
      if (event.type === 'message_update') {
        const msg = event.message as Message
        if (msg.role !== 'assistant') continue
        const text = msg.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('')
        finalOutput = text
        emit({ type: 'message_delta', conversationId, messageId, delta: text })
      } else if (event.type === 'message_end') {
        const msg = event.message as Message & { role: 'assistant' }
        if (msg.role === 'assistant') {
          if (msg.stopReason === 'error') {
            throw new Error(
              msg.errorMessage || 'The model returned an error without details.'
            )
          }
          // Capture the authoritative final text from message_end content
          const endText = msg.content
            .filter(
              (c): c is { type: 'text'; text: string } => c.type === 'text'
            )
            .map((c) => c.text)
            .join('')
          if (endText) finalOutput = endText
          if (msg.usage) {
            lastUsage = msg.usage
            totalInput += msg.usage.input ?? 0
            totalOutput += msg.usage.output ?? 0
          }
        }
      } else if (event.type === 'tool_execution_start') {
        emit({
          type: 'tool_card',
          conversationId,
          messageId,
          toolName: event.toolName,
          phase: 'start'
        })
        await createTaskExecutionEvent({
          executionId,
          eventType: 'tool_start',
          payload: { toolName: event.toolName }
        })
      } else if (event.type === 'tool_execution_end') {
        const result =
          event.result &&
          typeof event.result === 'object' &&
          'details' in event.result
            ? event.result.details
            : event.result
        emit({
          type: 'tool_card',
          conversationId,
          messageId,
          toolName: event.toolName,
          phase: 'end',
          result
        })
        await createTaskExecutionEvent({
          executionId,
          eventType: 'tool_end',
          payload: {
            toolName: event.toolName,
            result: typeof result === 'string' ? result : JSON.stringify(result)
          }
        })
      }
    }

    const cost = calculateCost(lastUsage, model).total
    await updateTaskExecution(executionId, {
      status: 'completed',
      completedAt: new Date(),
      tokenUsage: { inputTokens: totalInput, outputTokens: totalOutput, cost }
    })

    return finalOutput
  } finally {
    // Always close the live bubble — even on error — so the UI doesn't spin
    // forever. execution-engine.ts marks the execution `failed` separately.
    emit({ type: 'message_end', conversationId, messageId })
  }
}
