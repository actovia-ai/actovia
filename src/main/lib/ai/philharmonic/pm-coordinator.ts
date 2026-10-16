// src/main/lib/ai/philharmonic/pm-coordinator.ts
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import { agentLoop } from '@earendil-works/pi-agent-core'
import type { Message } from '@earendil-works/pi-ai'
import { CLI_NAMES } from '@exodus/shared/types/agents'
import type { Attachment } from '@exodus/shared/types/chat'
import { v4 as uuidV4 } from 'uuid'

import { cliOf } from '../../agents/drivers'
import {
  addMemberToConversation,
  createConversationMessage,
  getConversationById
} from '../../db/conversation-queries'
import { createTask, getActiveAgents } from '../../db/philharmonic-queries'
import {
  appendStepToPlan,
  createPlanWithSteps,
  getActivePlanByConversationId,
  updatePlanStatus,
  updateStep
} from '../../db/plan-queries'
import { getSettings } from '../../db/queries'
import { getAllTeams } from '../../db/team-queries'
import { mainT } from '../../i18n'
import { resolveKnowledgeBase } from '../../knowledge-base/resolve-knowledge-base'
import { logger } from '../../logger'
import { notifyIfBackground } from '../../philharmonic-notifications'
import { searchKnowledgeBase } from '../calling-tools/search-knowledge-base'
import { streamFn } from '../kernel/models'
import { getModelFromProvider } from '../utils/chat-message-util'
import { bareImageData } from '../utils/image-data'
import { createEscalateToUserTool } from './agent-tools'
import { askUserRegistry } from './ask-user-registry'
import type { SseEmitter } from './employee-loop'
import { runDelegatedTask } from './execution-engine'
import { PhilharmonicLcm } from './lcm'
import { toPlanDto, toStepDto } from './plan-dto'
import { writePlanMirror } from './plan-mirror'
import {
  createAppendPlanStepTool,
  createCreatePlanTool,
  createUpdatePlanStepTool
} from './plan-tools'
import { createDelegateTaskTool, createRecruitEmployeeTool } from './pm-tools'
import { autoCreateEmployee } from './recruit'
import { createReportTool, type PendingArtifact } from './report-tools'
import { groupBeforeToolCall } from './sensitive-guard'

const PM_SYSTEM_PROMPT = `You are the PM (project manager) of a virtual team working in a group chat.

Plan-first discipline (mandatory):
1. The FIRST tool call on every new user request MUST be createPlan. Lay out the whole execution as ordered steps with clear titles and intent. Even a one-step plan is fine.
2. Before each delegation, call updatePlanStep(stepId, status="running").
3. After each delegation, call updatePlanStep(stepId, status="done", output=<one-paragraph summary>). On failure, use status="failed". If you decide a step is no longer needed, use status="skipped".
4. If you discover work the original plan missed, call appendPlanStep — don't free-form delegate outside the plan.

Execution loop:
- Decide which employees are needed. If an existing one fits, delegate via delegateTask with stepId. If nobody fits, recruitEmployee first, then delegate.
- After each employee returns, REVIEW their output against the step's goal. If it falls short, update the step to "failed" (or "pending" if you want to retry) and either delegate again with corrections, or recruit/replace. Never pass along sub-par work.
- When every step is done, write ONE final message that summarizes the outcome. Do not call any tool in that final turn.

Use search_knowledge_base for company-specific facts before asking the user. Use askUser only when truly blocked.
Delegate to one employee at a time.`

function rosterText(
  agents: {
    name: string
    teamId: string | null
    description: string | null
  }[],
  teamNameById: Map<string, string>
): string {
  if (agents.length === 0) return '(no employees yet)'
  return agents
    .map((a) => {
      const teamName = a.teamId ? teamNameById.get(a.teamId) : null
      return `- ${a.name}${teamName ? ` [${teamName}]` : ''}: ${a.description ?? 'no description'}`
    })
    .join('\n')
}

type UserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

/**
 * Build the multimodal content payload for the CURRENT user turn. Historical
 * messages are rebuilt by PhilharmonicLcm.assembleContext which applies the
 * same rules internally. Matches the shape Chat uses in use-chat.ts so model
 * behavior stays consistent.
 */
function buildUserContent(
  text: string,
  attachments?: Attachment[]
): UserContentPart[] {
  const parts: UserContentPart[] = []
  if (text.length > 0) parts.push({ type: 'text', text })
  if (attachments) {
    for (const a of attachments) {
      if (a.contentType.startsWith('image/')) {
        parts.push({
          type: 'image',
          ...bareImageData(a.url, a.contentType)
        })
      }
    }
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '' }]
}

export interface RunPmArgs {
  conversationId: string
  userText: string
  /** Image attachments accompanying the current user turn. Persisted on the
   * user message row; the PM sees them as `image` content parts. v1 does
   * not pass them through to delegated employees. */
  attachments?: Attachment[]
  /** ID of the just-persisted user message; excluded from history so the LLM doesn't see this turn twice. */
  excludeMessageId?: string
  emit: SseEmitter
  signal?: AbortSignal
}

export async function runPmCoordinator(args: RunPmArgs): Promise<void> {
  const {
    conversationId,
    userText,
    attachments,
    excludeMessageId,
    emit,
    signal
  } = args
  // Tell the renderer the PM started so it can switch Send → Stop. Emitted
  // up front (before any DB work) so even fast-failing turns still close the
  // busy state via pm_ended below.
  emit({ type: 'pm_started', conversationId })

  const setting = await getSettings()
  const { model, apiKey } = getModelFromProvider(setting)

  const [employees, allTeams, conversationRow] = await Promise.all([
    getActiveAgents(),
    getAllTeams(),
    getConversationById(conversationId)
  ])
  const conversationTitle = conversationRow?.title ?? 'Group'
  // Who the PM may delegate to; a recruit joins it (see createDelegateTaskTool).
  const roster = employees.map((e) => ({
    id: e.id,
    name: e.name,
    description:
      e.runtime === 'exodus'
        ? e.description
        : `${e.description ?? ''} [Coding agent — ${CLI_NAMES[cliOf(e.runtime)]} on the owner's machine; it works in this group's folder${conversationRow?.projectId ? '' : ' — UNAVAILABLE: this group has no folder yet'}. Give it whole tasks with a clear "done"; its reply says what it changed.]`.trim()
  }))
  const teamNameById = new Map(allTeams.map((t) => [t.id, t.name]))

  // PhilharmonicLcm hydrates the LLM history: when within budget it's a
  // straight conversion of every persisted message; when over, it replaces
  // the oldest turns with a rolling summary it maintains itself. The switch
  // and the threshold mirror Chat's LCM; the tail is its own — Chat's
  // `freshTailSize` counts runs since the kernel rewrite, this one counts
  // messages, and 16 is what it always kept.
  const lcm = new PhilharmonicLcm(conversationId, model, apiKey, {
    enabled: setting.memory?.lcmEnabled ?? true,
    contextWindowPercent: setting.memory?.contextWindowPercent ?? 75,
    freshTailSize: 16
  })
  const history = await lcm.assembleContext(excludeMessageId)
  const kb = resolveKnowledgeBase(setting)

  // Pick up an existing active plan if one is still in flight; PM mutates it
  // instead of creating a new one. The createPlan tool starts a fresh plan
  // when the previous one is completed/aborted.
  let activePlan = await getActivePlanByConversationId(conversationId)
  if (activePlan && activePlan.plan.status === 'completed') activePlan = null

  // The markdown mirror is a copy for the owner: a failed write is logged and
  // never fails the step or the tool that changed the plan.
  const mirror = async (write: () => Promise<unknown>) => {
    try {
      await write()
    } catch (error) {
      logger.warn('philharmonic', 'plan mirror failed', {
        conversationId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
  // Rewrite the markdown mirror; safe to call after any mutation.
  const mirrorActivePlan = () =>
    mirror(async () => {
      const cur = await getActivePlanByConversationId(conversationId)
      if (cur) await writePlanMirror(conversationId, cur.plan, cur.steps)
    })

  // P1-7: createReport pushes here; attached as message parts at turn end so
  // ArtifactCard can render on history reload, not just from the live stream.
  const pendingArtifacts: PendingArtifact[] = []

  const tools: AgentTool[] = [
    createCreatePlanTool(async ({ summary, steps }) => {
      // If the LLM tries to create a plan while one is still active (shouldn't
      // happen per prompt, but defend), close the old one first.
      if (activePlan && activePlan.plan.status === 'active') {
        await updatePlanStatus(activePlan.plan.id, 'aborted')
        emit({
          type: 'plan_status_changed',
          conversationId,
          status: 'aborted'
        })
      }
      const created = await createPlanWithSteps({
        conversationId,
        summary,
        steps: steps.map((s) => ({
          title: s.title,
          intent: s.intent,
          assignedAgentId: s.assignedAgentId
        }))
      })
      activePlan = created
      emit({
        type: 'plan_created',
        conversationId,
        plan: toPlanDto(created.plan, created.steps)
      })
      await mirror(() =>
        writePlanMirror(conversationId, created.plan, created.steps)
      )
      return {
        planId: created.plan.id,
        steps: created.steps.map((s) => ({
          id: s.id,
          title: s.title,
          ordinal: s.ordinal
        }))
      }
    }),
    createUpdatePlanStepTool(async ({ stepId, status, output, note }) => {
      const updated = await updateStep(stepId, {
        status,
        output: output ?? undefined,
        note: note ?? undefined
      })
      emit({
        type: 'plan_step_updated',
        conversationId,
        stepId,
        patch: {
          status: updated.status,
          output: updated.output,
          note: updated.note,
          startedAt: updated.startedAt ? updated.startedAt.toISOString() : null,
          completedAt: updated.completedAt
            ? updated.completedAt.toISOString()
            : null
        }
      })
      await mirrorActivePlan()
      return { stepId: updated.id }
    }),
    createAppendPlanStepTool(async ({ title, intent, assignedAgentId }) => {
      const planId = activePlan?.plan.id
      if (!planId) {
        throw new Error(
          'Cannot append step: no active plan. Call createPlan first.'
        )
      }
      const step = await appendStepToPlan(planId, {
        title,
        intent,
        assignedAgentId
      })
      emit({
        type: 'plan_step_appended',
        conversationId,
        step: toStepDto(step)
      })
      await mirrorActivePlan()
      return { stepId: step.id, ordinal: step.ordinal }
    }),
    createDelegateTaskTool(
      roster,
      async ({ employeeId, instructions, stepId }) => {
        // Bind to a plan step if provided. Mark running before kicking off
        // the employee loop, done/failed afterwards.
        if (stepId) {
          const ran = await updateStep(stepId, { status: 'running' })
          emit({
            type: 'plan_step_updated',
            conversationId,
            stepId,
            patch: {
              status: ran.status,
              startedAt: ran.startedAt ? ran.startedAt.toISOString() : null
            }
          })
          await mirrorActivePlan()
        }
        const childTask = await createTask({
          conversationId,
          title: `Delegated: ${instructions.slice(0, 80)}`,
          description: instructions,
          status: 'pending',
          priority: 'medium',
          assignedAgentId: employeeId,
          input: null,
          output: null,
          maxRetries: 1,
          retryCount: 0
        })
        try {
          const { output, messageId } = await runDelegatedTask({
            taskId: childTask.id,
            agentId: employeeId,
            conversationId,
            instructions,
            emit,
            signal
          })
          // Persist the employee's final output as a chat bubble — a coding
          // agent's step saved its own as it began (its card lives there).
          if (!messageId)
            await createConversationMessage({
              conversationId,
              role: 'employee',
              agentId: employeeId,
              content: output,
              taskId: childTask.id
            })
          if (stepId) {
            // Step status moves to "done" only when the PM later calls
            // updatePlanStep — we don't auto-close, so the PM can choose
            // "done"/"failed" based on its review. We just attach the taskId.
            await updateStep(stepId, {
              taskId: childTask.id,
              output
            })
            await mirrorActivePlan()
          }
          return output
        } catch (err) {
          if (stepId) {
            const failed = await updateStep(stepId, { status: 'failed' })
            emit({
              type: 'plan_step_updated',
              conversationId,
              stepId,
              patch: {
                status: failed.status,
                completedAt: failed.completedAt
                  ? failed.completedAt.toISOString()
                  : null
              }
            })
            await mirrorActivePlan()
          }
          throw err
        }
      }
    ),
    createRecruitEmployeeTool(async ({ role, skills, name }) => {
      const emp = await autoCreateEmployee({ role, skills, name })
      await addMemberToConversation(conversationId, emp.id)
      emit({ type: 'member_joined', conversationId, agentId: emp.id })
      roster.push({ id: emp.id, name: emp.name, description: null })
      return { id: emp.id, name: emp.name }
    }),
    ...(kb ? [searchKnowledgeBase(kb, setting.knowledgeBase)] : []),
    createReportTool(conversationId, (a) => pendingArtifacts.push(a)),
    createEscalateToUserTool(async ({ question, options }) => {
      emit({ type: 'ask_user', conversationId, question, options })
      return askUserRegistry.wait(conversationId)
    })
  ]

  const userMessage: Message = {
    role: 'user',
    content: buildUserContent(userText, attachments),
    timestamp: Date.now()
  }

  const messageId = uuidV4()
  emit({ type: 'message_start', conversationId, messageId, role: 'pm' })

  let finalText = ''
  try {
    const stream = agentLoop(
      [userMessage as AgentMessage],
      {
        // pi 1.0: the system prompt and the tool declarations lead the
        // transcript as a system message, ahead of the history.
        messages: [
          {
            role: 'system',
            content:
              PM_SYSTEM_PROMPT +
              `\n\nEmployees:\n${rosterText(employees, teamNameById)}`,
            toolsAdded: tools,
            timestamp: Date.now()
          },
          // The conversation's stored `system` rows are UI notes ("[Scheduled]
          // …", "⚠️ PM error …"), not prompts — kept out of what the
          // model reads, as they always were.
          ...(history as AgentMessage[]).filter(
            (m) => (m as Message).role !== 'system'
          )
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
        // Secrets outside Exodus: refused in a Group run (sensitive-guard.ts).
        beforeToolCall: groupBeforeToolCall(conversationId)
      },
      signal,
      streamFn
    )

    for await (const event of stream) {
      if (event.type === 'message_update') {
        const msg = event.message as Message
        if (msg.role !== 'assistant') continue
        finalText = msg.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('')
        emit({
          type: 'message_delta',
          conversationId,
          messageId,
          delta: finalText
        })
      } else if (event.type === 'message_end') {
        const msg = event.message as Message & { role: 'assistant' }
        if (msg.role === 'assistant') {
          if (msg.stopReason === 'error') {
            throw new Error(
              msg.errorMessage ||
                'The PM model returned an error without details.'
            )
          }
          // Capture final text from message_end content if not already set via streaming
          const endText = msg.content
            .filter(
              (c): c is { type: 'text'; text: string } => c.type === 'text'
            )
            .map((c) => c.text)
            .join('')
          if (endText) finalText = endText
        }
      }
    }
  } catch (err) {
    const isAbort =
      (err instanceof Error && err.name === 'AbortError') ||
      signal?.aborted === true
    const message = err instanceof Error ? err.message : String(err)

    if (isAbort) {
      // Mark every still-running step on the active plan as failed so the
      // plan card reflects the interruption. We don't transition the plan
      // status — the user may follow up with another message to continue.
      const cur = await getActivePlanByConversationId(conversationId)
      if (cur) {
        for (const step of cur.steps) {
          if (step.status === 'running') {
            const updated = await updateStep(step.id, {
              status: 'failed',
              note: 'Interrupted by user'
            })
            emit({
              type: 'plan_step_updated',
              conversationId,
              stepId: step.id,
              patch: {
                status: updated.status,
                note: updated.note,
                completedAt: updated.completedAt
                  ? updated.completedAt.toISOString()
                  : null
              }
            })
          }
        }
        await mirrorActivePlan()
      }
      emit({
        type: 'conversation_error',
        conversationId,
        error: 'PM run was interrupted by the user.'
      })
      await createConversationMessage({
        conversationId,
        role: 'system',
        content: '⚠️ PM run was interrupted by the user.'
      })
      emit({ type: 'message_end', conversationId, messageId })
      emit({ type: 'pm_ended', conversationId, reason: 'aborted' })
      return
    }

    emit({ type: 'conversation_error', conversationId, error: message })
    await createConversationMessage({
      conversationId,
      role: 'system',
      content: `⚠️ PM error: ${message}`
    })
    emit({ type: 'message_end', conversationId, messageId })
    notifyIfBackground({
      title: mainT(
        'menu:notification.philharmonicGroupError',
        'Group "{{title}}" hit an error',
        { title: conversationTitle }
      ),
      body: message.length > 140 ? `${message.slice(0, 137)}…` : message
    })
    emit({ type: 'pm_ended', conversationId, reason: 'error' })
    return
  }

  // Attach every artifact createReport produced this turn so the PM's final
  // bubble can render the ArtifactCard on history reload as well as the live
  // stream. Stored as { kind: 'artifact', artifactId, title, code }; bubble
  // renderer reads the same shape attachments use.
  const artifactParts =
    pendingArtifacts.length > 0
      ? pendingArtifacts.map((a) => ({
          kind: 'artifact' as const,
          artifactId: a.artifactId,
          title: a.title,
          code: a.code
        }))
      : null
  await createConversationMessage({
    conversationId,
    role: 'pm',
    content: finalText,
    parts: artifactParts
  })
  emit({ type: 'message_end', conversationId, messageId })

  // Auto-close the plan when every step has reached a terminal state. The PM
  // doesn't need to ceremoniously declare the plan done — finishing the turn
  // without follow-up tools implies it.
  const final = await getActivePlanByConversationId(conversationId)
  if (final && final.plan.status === 'active' && final.steps.length > 0) {
    const allTerminal = final.steps.every(
      (s) =>
        s.status === 'done' || s.status === 'skipped' || s.status === 'failed'
    )
    if (allTerminal) {
      await updatePlanStatus(final.plan.id, 'completed')
      emit({
        type: 'plan_status_changed',
        conversationId,
        status: 'completed'
      })
      await mirrorActivePlan()
      const summary = final.plan.summary
      notifyIfBackground({
        title: mainT(
          'menu:notification.philharmonicGroupFinished',
          'Group "{{title}}" finished',
          { title: conversationTitle }
        ),
        body: summary.length > 140 ? `${summary.slice(0, 137)}…` : summary
      })
    }
  }

  // Fire-and-forget LCM compaction. Errors are caught inside trackAndCompact
  // so we don't crash the turn we just finished. Next turn's assembleContext
  // will pick up the new summary if compaction lands first.
  lcm.trackAndCompact().catch(() => {})

  emit({ type: 'pm_ended', conversationId, reason: 'done' })
}
