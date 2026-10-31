// src/main/lib/ai/philharmonic/employee-loop.ts
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { PhilharmonicSseEvent } from '@actovia/shared/types/philharmonic'
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import { agentLoop } from '@earendil-works/pi-agent-core'
import type { Message } from '@earendil-works/pi-ai'
import { v4 as uuidV4 } from 'uuid'

import { getEmployeeReports } from '../../db/conversation-queries'
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
import { resolveEmployeeModel } from '../utils/employee-model'
import { createAskPmTool } from './agent-tools'
import { groupBeforeToolCall } from './sensitive-guard'

export type SseEmitter = (event: PhilharmonicSseEvent) => void

export interface RunEmployeeLoopArgs {
  onBlocked?: (question: string) => void
  agent: Agent
  instructions: string
  executionId: string
  conversationId: string
  emit: SseEmitter
  /** Additional tools besides the employee loadout and its built-in ask_pm. */
  extraTools?: AgentTool[]
  signal?: AbortSignal
  /** The id its live bubble streams under — the saved row takes the same one,
   * so the transcript shows it once. A fresh one when not given. */
  messageId?: string
}

/**
 * Who reads an employee's report — the PM, then the owner — never sees its
 * search results, so a numbered marker ("【8】") points nowhere: it cites by
 * link, which the group's transcript renders and opens.
 */
export const WEB_CITATIONS = `

Citing the web: whoever reads your report cannot see your search results, so never cite by number (no 【3】, [3] or 【3-source】). Put the source after the sentence it supports as a Markdown link with the site or page title as its text — ([The Verge](https://www.theverge.com/...)) — using the URL a web_search result or web_fetch gave you, never one you made up.`

/** How many of an employee's own earlier reports it is shown, and how much of each. */
export const EARLIER_REPORTS = { count: 3, chars: 6000 }

/**
 * An employee's own earlier reports in this group, oldest first. Each run of
 * the loop starts fresh, so without them a second task found the employee
 * unaware of its own work, and the PM pasted the report back in.
 */
export function earlierReportsBlock(
  reports: Array<{ content: string; createdAt: Date }>
): string {
  if (reports.length === 0) return ''
  const items = [...reports]
    .reverse()
    .map((r) => {
      const text =
        r.content.length > EARLIER_REPORTS.chars
          ? `${r.content.slice(0, EARLIER_REPORTS.chars)}\n[… cut, ${r.content.length - EARLIER_REPORTS.chars} more characters]`
          : r.content
      return `<report at="${r.createdAt.toISOString()}">\n${text}\n</report>`
    })
    .join('\n')
  return `\n\nYour earlier reports in this group (oldest first). Build on them instead of redoing the work; where the PM's new instructions differ, follow the instructions.\n${items}`
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
    'When finished, give a clear, self-contained summary of what you did and the result.',
    'If you need a decision, missing information or approval from the PM, call ask_pm with your question. This pauses your task and returns control to the PM; do not guess the answer.'
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
  let blockedQuestion: string | undefined
  tools = [
    ...tools,
    createAskPmTool((question) => {
      blockedQuestion ??= question
    })
  ]
  const guard = groupBeforeToolCall(conversationId)

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
  const reportsBlock = earlierReportsBlock(
    await getEmployeeReports(conversationId, agent.id, EARLIER_REPORTS.count)
  )
  const team = agent.teamId ? ((await getTeamById(agent.teamId)) ?? null) : null
  const searches = tools.some(
    (t) => t.name === TOOL_NAMES.webSearch || t.name === TOOL_NAMES.webFetch
  )
  const systemPrompt =
    buildEmployeeSystemPrompt(agent, team) +
    (searches ? WEB_CITATIONS : '') +
    memoryBlock +
    reportsBlock +
    skillsContent

  const userMessage: Message = {
    role: 'user',
    content: [{ type: 'text', text: instructions }],
    timestamp: Date.now()
  }

  const messageId = args.messageId ?? uuidV4()
  emit({
    type: 'message_start',
    conversationId,
    messageId,
    role: 'employee',
    agentId: agent.id
  })

  let finalOutput = ''
  // Every step of the loop is a request of its own: its tokens are added up.
  // Input counts what the
  // model read, the cached part included (the dashboard's "total processed").
  let totalInput = 0
  let totalOutput = 0

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
      beforeToolCall: (context) =>
        blockedQuestion
          ? Promise.resolve({
              block: true,
              terminate: true,
              reason: 'Task paused while waiting for the PM.'
            })
          : guard(context),
      finishTurn: async () =>
        blockedQuestion ? { action: 'end' as const } : undefined
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
            totalInput +=
              (msg.usage.input ?? 0) +
              (msg.usage.cacheRead ?? 0) +
              (msg.usage.cacheWrite ?? 0)
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

    await updateTaskExecution(executionId, {
      status: 'completed',
      completedAt: new Date(),
      tokenUsage: {
        inputTokens: totalInput,
        outputTokens: totalOutput
      }
    })

    if (blockedQuestion) {
      args.onBlocked?.(blockedQuestion)
      return `[Blocked — question for PM]\n${blockedQuestion}${finalOutput ? `\n\nProgress before pausing:\n${finalOutput}` : ''}`
    }
    return finalOutput
  } finally {
    // Always close the live bubble — even on error — so the UI doesn't spin
    // forever. execution-engine.ts marks the execution `failed` separately.
    emit({ type: 'message_end', conversationId, messageId })
  }
}
