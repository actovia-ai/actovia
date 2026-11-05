import { resolvePhilharmonicSettings } from '@actovia/shared/constants/philharmonic-settings'
import { SETTING_DEFAULTS } from '@actovia/shared/constants/setting-defaults'
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
// src/main/lib/ai/philharmonic/pm-coordinator.ts
import { CLI_NAMES, type CliId } from '@actovia/shared/types/agents'
import type { McpTools } from '@actovia/shared/types/ai'
import type { Attachment } from '@actovia/shared/types/chat'
import {
  withGroupMentions,
  type GroupMention
} from '@actovia/shared/types/philharmonic'
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import { agentLoop } from '@earendil-works/pi-agent-core'
import { Type, type Message } from '@earendil-works/pi-ai'
import { v4 as uuidV4 } from 'uuid'

import { cliOf, isCliId } from '../../agents/drivers'
import {
  blockedUntil,
  formatQuotaForPm,
  getQuota,
  quotaWindowLabel
} from '../../agents/quota'
import { refreshQuotas } from '../../agents/quota-refresh'
import { measureContext } from '../../chat/context-snapshot'
import {
  addMemberToConversation,
  createConversationMessage,
  getConversationById,
  getMessagesByConversationId,
  updateConversationTitleIfUnchanged
} from '../../db/conversation-queries'
import {
  createTask,
  getActiveAgents,
  getUpcomingOneOffTasks,
  updateTask
} from '../../db/philharmonic-queries'
import {
  appendStepToPlan,
  createPlanWithSteps,
  getActivePlanByConversationId,
  updatePlanStatus,
  updatePlanSummary,
  updateStep
} from '../../db/plan-queries'
import { lastRoundStartedAt } from '../../db/pm-round-queries'
import { getSettings } from '../../db/queries'
import { getAllTeams } from '../../db/team-queries'
import { mainT } from '../../i18n'
import { resolveKnowledgeBase } from '../../knowledge-base/resolve-knowledge-base'
import { logger } from '../../logger'
import { notifyIfBackground } from '../../philharmonic-notifications'
import { emitToConversation } from '../../server/routes/philharmonic-sse'
import { closeAutomationTools } from '../calling-tools/automation-lifecycle'
import { mcpDirectory, mcpToolbox } from '../calling-tools/mcp-toolbox'
import { searchKnowledgeBase } from '../calling-tools/search-knowledge-base'
import type { ContextMessageKind } from '../context-management/context-assembler'
import { estimateMessageTokens } from '../context-management/token-counter'
import { streamFn } from '../kernel/models'
import { getMcpTools } from '../mcp'
import { trustedContextWindow } from '../providers/resolve-model'
import {
  bindCallingTools,
  generateTitleFromText,
  getModelFromProvider
} from '../utils/chat-message-util'
import { bareImageData } from '../utils/image-data'
import { reflectOnReviewedTask } from './agent-memory'
import { createEscalateToUserTool } from './agent-tools'
import { archiveOutput, type ArchiveEntry } from './archive'
import type { SseEmitter } from './employee-loop'
import { runDelegatedTask } from './execution-engine'
import { groupBriefTool, initializeGroupBrief } from './group-brief'
import { askOwner } from './group-questions'
import { PhilharmonicLcm } from './lcm'
import { loopBudget } from './loop-budget'
import { modelRouter } from './model-router'
import { toPlanDto, toStepDto } from './plan-dto'
import { writePlanMirror } from './plan-mirror'
import {
  createAppendPlanStepTool,
  createCreatePlanTool,
  createUpdatePlanStepTool
} from './plan-tools'
import { PM_SYSTEM_PROMPT, pmMcpSection } from './pm-prompt'
import { pmRunRegistry } from './pm-run-registry'
import {
  createDelegateTaskTool,
  createRecruitEmployeeTool,
  createWatchForTool,
  createWaitForQuotaTool,
  quotaWaitRunAt
} from './pm-tools'
import { autoCreateEmployee, recruitmentModelOptions } from './recruit'
import { createRoundRecorder } from './round-recorder'
import { groupBeforeToolCall } from './sensitive-guard'
import { groupWorkspace } from './workspace'

function rosterText(
  agents: {
    name: string
    teamId: string | null
    description: string | null
    runtime: string
    provider: string | null
    model: string | null
  }[],
  teamNameById: Map<string, string>
): string {
  if (agents.length === 0) return '(no employees yet)'
  return agents
    .map((a) => {
      const teamName = a.teamId ? teamNameById.get(a.teamId) : null
      const model =
        a.runtime === 'actovia'
          ? a.provider && a.model
            ? ` (${a.provider} · ${a.model})`
            : ''
          : ` (${CLI_NAMES[cliOf(a.runtime)]}, model: ${a.model || 'CLI default'})`
      return `- ${a.name}${model}${teamName ? ` [${teamName}]` : ''}: ${a.description ?? 'no description'}`
    })
    .join('\n')
}

/** The owner's local time, as the PM reads it (English: the model reads it). */
const formatWhen = (d: Date) =>
  d.toLocaleString('en-US', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

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
  mentions?: GroupMention[]
  /** Image attachments accompanying the current user turn. Persisted on the
   * user message row; the PM sees them as `image` content parts. v1 does
   * not pass them through to delegated employees. */
  attachments?: Attachment[]
  /** ID of the just-persisted user message; excluded from history so the LLM doesn't see this turn twice. */
  excludeMessageId?: string
  emit: SseEmitter
  signal?: AbortSignal
  /** What started the round, for its decision trail. */
  trigger?: 'user' | 'scheduled' | 'report'
}

export async function runPmCoordinator(args: RunPmArgs): Promise<void> {
  try {
    await coordinate(args)
  } catch (error) {
    args.emit({
      type: 'conversation_error',
      conversationId: args.conversationId,
      error: error instanceof Error ? error.message : String(error)
    })
    args.emit({
      type: 'pm_ended',
      conversationId: args.conversationId,
      reason: args.signal?.aborted ? 'aborted' : 'error'
    })
    throw error
  } finally {
    pmRunRegistry.closeSteering(args.conversationId)
  }
}

async function coordinate(args: RunPmArgs): Promise<void> {
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
  pmRunRegistry.openSteering(conversationId)

  const setting = await getSettings()
  const { model, apiKey } = getModelFromProvider(setting)

  const [employees, allTeams, conversationRow] = await Promise.all([
    getActiveAgents(),
    getAllTeams(),
    getConversationById(conversationId)
  ])
  let conversationTitle = conversationRow?.title ?? 'Group'
  const defaultGroupTitle = mainT(
    'philharmonic:container.newGroupDefaultTitle',
    'New group'
  )
  const titlePromise =
    (args.trigger ?? 'user') === 'user' &&
    conversationRow?.title === defaultGroupTitle &&
    userText.trim().length > 0
      ? generateTitleFromText({ text: userText, model, apiKey })
      : null
  // Who the PM may delegate to; a recruit joins it (see createDelegateTaskTool).
  const roster = employees.map((e) => ({
    id: e.id,
    name: e.name,
    provider: e.provider,
    model: e.model,
    description:
      e.runtime === 'actovia'
        ? e.description
        : `${e.description ?? ''} [Coding agent — ${CLI_NAMES[cliOf(e.runtime)]} (model: ${e.model || 'CLI default'}) on the owner's machine; it works in this group's folder${conversationRow?.projectId ? '' : ' — UNAVAILABLE: this group has no folder yet'}. Give it whole tasks with a clear "done"; its reply says what it changed.]`.trim()
  }))
  const teamNameById = new Map(allTeams.map((t) => [t.id, t.name]))

  // The quota of every CLI an employee runs on, read fresh where it can be
  // without spending any (spec 2026-10-16 §4): the PM deals with it in view.
  const clisInPlay = [
    ...new Set(
      employees.filter((e) => isCliId(e.runtime)).map((e) => e.runtime as CliId)
    )
  ]
  // A store that cannot be read must not stop the round: every line is unknown.
  let quotaText: string
  try {
    await refreshQuotas(clisInPlay)
    const now = Date.now()
    quotaText = clisInPlay
      .map((cli) => formatQuotaForPm(getQuota(cli), cli, now))
      .join('\n')
  } catch (error) {
    logger.warn('philharmonic', 'quota lines not built', { error })
    const now = Date.now()
    quotaText = clisInPlay
      .map((cli) => formatQuotaForPm(null, cli, now))
      .join('\n')
  }

  // PhilharmonicLcm hydrates the LLM history: when within budget it's a
  // straight conversion of every persisted message; when over, it replaces
  // the oldest turns with a rolling summary it maintains itself. The switch
  // and the threshold mirror Chat's LCM; the tail is its own — Chat's
  // `freshTailSize` counts runs since the kernel rewrite, this one counts
  // messages, and 16 is what it always kept.
  const lcmEnabled = setting.memory?.lcmEnabled ?? true
  const contextWindowPercent =
    setting.memory?.contextWindowPercent ??
    SETTING_DEFAULTS.memory.contextWindowPercent
  const contextWindow = trustedContextWindow(model) || 128_000
  const lcm = new PhilharmonicLcm(conversationId, model, apiKey, {
    enabled: lcmEnabled,
    contextWindowPercent,
    contextWindow,
    freshTailSize: 16
  })
  const history = await lcm.assembleContext(excludeMessageId, () =>
    pmRunRegistry.pendingMessageIds(conversationId)
  )
  const kb = resolveKnowledgeBase(setting)
  // The owner's MCP servers (Settings → MCP) are the PM's too: it files and
  // moves issues, reads trackers and accepts work there itself, not only
  // through an employee. A server that will not connect is logged by
  // getMcpTools and left out; nothing here fails the round.
  let mcpServers: McpTools[] = []
  try {
    mcpServers = await getMcpTools()
  } catch (error) {
    logger.warn('philharmonic', 'PM MCP tools unavailable', {
      conversationId,
      error
    })
  }

  // Pick up an existing active plan if one is still in flight; PM mutates it
  // instead of creating a new one. The createPlan tool starts a fresh plan
  // when the previous one is completed/aborted.
  let activePlan = await getActivePlanByConversationId(conversationId)
  if (activePlan && activePlan.plan.status === 'completed') activePlan = null
  // The plan in flight, as the PM must see it to continue it (a wake-up round
  // after waitForQuota starts with nothing else in view).
  const nameOf = (id: string | null) =>
    (id && employees.find((e) => e.id === id)?.name) || 'unassigned'
  const planText =
    activePlan && activePlan.plan.status === 'active'
      ? `Active plan: ${activePlan.plan.summary}\n` +
        activePlan.steps
          .map(
            (st) =>
              `- [${st.status}] step ${st.ordinal} (id: ${st.id}): ${st.title} — assigned: ${nameOf(st.assignedAgentId)}${st.note ? ` — note: ${st.note}` : ''}`
          )
          .join('\n')
      : ''

  // The markdown mirror is a copy for the owner: a failed write is logged and
  // never fails the step or the tool that changed the plan. Writes queue one
  // behind another: the PM calls plan tools in parallel (a step set running
  // and delegated in one turn), and two writes through the one plan.md.tmp
  // lost the race — the second rename found the file already moved — or
  // could leave the older state last.
  let mirrorQueue: Promise<void> = Promise.resolve()
  const mirror = (write: () => Promise<unknown>) => {
    mirrorQueue = mirrorQueue.then(async () => {
      try {
        await write()
      } catch (error) {
        logger.warn('philharmonic', 'plan mirror failed', {
          conversationId,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    })
    return mirrorQueue
  }
  // Rewrite the markdown mirror; safe to call after any mutation.
  const mirrorActivePlan = () =>
    mirror(async () => {
      const cur = await getActivePlanByConversationId(conversationId)
      if (cur) await writePlanMirror(conversationId, cur.plan, cur.steps)
    })

  // Whoever the PM hands a step to is one of the group's members — the header
  // and the Members panel list them. Only a recruit used to join, so a group
  // run by existing employees read "0 members". A failed write is logged and
  // never fails the step.
  const memberIds = new Set<string>(
    (conversationRow?.memberAgentIds as string[] | null) ?? []
  )
  const joinGroup = async (agentId: string) => {
    if (memberIds.has(agentId)) return
    memberIds.add(agentId)
    try {
      await addMemberToConversation(conversationId, agentId)
      emit({ type: 'member_joined', conversationId, agentId })
    } catch (error) {
      memberIds.delete(agentId)
      logger.warn('philharmonic', 'group member not added', {
        conversationId,
        agentId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  // P1-7: createReport pushes here; attached as message parts at turn end so
  // ArtifactCard can render on history reload, not just from the live stream.
  const pendingArchives: ArchiveEntry[] = []

  // The window that stops an employee's CLI from running it now, as the
  // delegateTask refusal the PM reads; null when nothing blocks it.
  const quotaBlock = (employeeId: string): string | null => {
    const emp = employees.find((e) => e.id === employeeId)
    if (!emp || !isCliId(emp.runtime)) return null
    const w = blockedUntil(getQuota(emp.runtime), emp.model)
    if (!w) return null
    const reset =
      w.resetsAt === null ? 'an unknown time' : formatWhen(new Date(w.resetsAt))
    return `Not started: ${emp.name}'s ${CLI_NAMES[emp.runtime]} quota is used up (${quotaWindowLabel(w)} ${Math.round(w.usedPercent)} %), resets ${reset}. Give the step to another employee, or call waitForQuota. If you had marked the step running, set it back to pending, or call waitForQuota.`
  }

  // A step that leaves `pending` (done, failed, running, delegated) no longer
  // waits: its quota wake-up, if it has one, is cancelled.
  const cancelQuotaWait = async (stepId: string) => {
    const waiting = (await getUpcomingOneOffTasks()).filter((t) => {
      const input = t.input as Record<string, unknown> | null
      return (
        t.conversationId === conversationId &&
        input?.kind === 'quota-wait' &&
        input?.stepId === stepId
      )
    })
    for (const t of waiting) await updateTask(t.id, { status: 'cancelled' })
  }

  await initializeGroupBrief(conversationId, userText)
  const workspace = await groupWorkspace(conversationId)
  const operationalNames = new Set<string>([
    TOOL_NAMES.terminal,
    TOOL_NAMES.readFile,
    TOOL_NAMES.writeFile,
    TOOL_NAMES.editFile,
    TOOL_NAMES.listDirectory,
    TOOL_NAMES.findFiles,
    TOOL_NAMES.grep,
    TOOL_NAMES.webSearch,
    TOOL_NAMES.webFetch,
    TOOL_NAMES.computerUse,
    TOOL_NAMES.browserUse
  ])
  const operationalTools = bindCallingTools({
    advancedTools: [],
    setting,
    groupId: conversationId,
    workspaceDir: workspace.dir
  }).filter((tool) => operationalNames.has(tool.name))
  const delegationAttempts = new Map<string, number>()
  const router = modelRouter(setting, { model, apiKey })
  const controls = resolvePhilharmonicSettings(setting.agents)
  const budget = loopBudget(controls.pmMaxToolCalls, controls.failureLimit)
  const tools: AgentTool[] = [
    groupBriefTool(conversationId),
    ...operationalTools,
    ...router.tools,
    {
      name: 'revisePlan',
      label: 'Revise Plan',
      description:
        'Update the active plan summary when the owner changes the goal. Keep its completed work; skip obsolete steps and append missing steps separately. The pinned plan bar updates immediately.',
      parameters: Type.Object({ summary: Type.String() }),
      execute: async (_id: string, { summary }: { summary: string }) => {
        const current = await getActivePlanByConversationId(conversationId)
        if (!current || current.plan.status !== 'active')
          throw new Error('No active plan to revise.')
        await updatePlanSummary(current.plan.id, summary)
        current.plan.summary = summary
        emit({
          type: 'plan_created',
          conversationId,
          plan: toPlanDto(current.plan, current.steps)
        })
        await mirrorActivePlan()
        return {
          content: [{ type: 'text' as const, text: 'Plan revised.' }],
          details: { planId: current.plan.id }
        }
      }
    } as AgentTool,
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
      if (status && updated.status !== 'pending') await cancelQuotaWait(stepId)
      if (status === 'done' && updated.status === 'done' && updated.taskId) {
        await reflectOnReviewedTask({
          taskId: updated.taskId,
          conversationId,
          pmReview: output ?? ''
        })
      }
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
      async ({ employeeId, instructions, stepId, mode = 'await' }) => {
        const attemptKey = stepId || instructions.trim()
        const attempts = delegationAttempts.get(attemptKey) ?? 0
        if (attempts >= controls.failureLimit)
          return `Not started: this step has already been attempted ${controls.failureLimit} times. Stop and ask the owner for the missing decision or evidence; do not delegate it again.`
        delegationAttempts.set(attemptKey, attempts + 1)
        // A CLI that has rejected this employee's model starts no process.
        const blocked = quotaBlock(employeeId)
        if (blocked) return blocked
        if (roster.some((r) => r.id === employeeId)) await joinGroup(employeeId)
        if (stepId) await cancelQuotaWait(stepId)
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
        const onFollowUp = async ({ output }: { output: string }) => {
          if (signal?.aborted) return
          await pmRunRegistry.run(conversationId, async (reportSignal) => {
            // A report may have waited behind another round or group deletion.
            if (signal?.aborted || !(await getConversationById(conversationId)))
              return
            await updateTask(childTask.id, { output: { result: output } })
            if (stepId) await updateStep(stepId, { output })
            await runPmCoordinator({
              conversationId,
              userText: `[Employee follow-up report · task ${childTask.id}] ${output}`,
              trigger: 'report',
              emit: (event) => emitToConversation(conversationId, event),
              signal: reportSignal
            })
          })
        }
        if (mode === 'background') {
          void runDelegatedTask({
            taskId: childTask.id,
            agentId: employeeId,
            conversationId,
            instructions,
            emit,
            signal,
            onFollowUp
          })
            .then(
              async ({ output, messageId, liveMessageId, blockedQuestion }) => {
                if (!messageId)
                  await createConversationMessage({
                    id: liveMessageId,
                    conversationId,
                    role: 'employee',
                    agentId: employeeId,
                    content: output,
                    taskId: childTask.id
                  })
                if (stepId) {
                  await updateStep(stepId, {
                    taskId: childTask.id,
                    output,
                    ...(blockedQuestion
                      ? {
                          status: 'pending',
                          note: `Needs PM: ${blockedQuestion}`
                        }
                      : {})
                  })
                  if (blockedQuestion)
                    emit({
                      type: 'plan_step_updated',
                      conversationId,
                      stepId,
                      patch: {
                        status: 'pending',
                        note: `Needs PM: ${blockedQuestion}`,
                        output
                      }
                    })
                  await mirrorActivePlan()
                }
                await pmRunRegistry.run(conversationId, (reportSignal) =>
                  runPmCoordinator({
                    conversationId,
                    userText: `[Employee report] ${output}`,
                    trigger: 'report',
                    emit,
                    signal: reportSignal
                  })
                )
              }
            )
            .catch(async (err) => {
              if (stepId) {
                const failed = await updateStep(stepId, { status: 'failed' })
                emit({
                  type: 'plan_step_updated',
                  conversationId,
                  stepId,
                  patch: { status: failed.status }
                })
              }
              logger.error('philharmonic', 'Background delegation failed', {
                taskId: childTask.id,
                error: err
              })
            })
          return `Started task ${childTask.id} in the background. Its report will continue the plan when it completes.`
        }
        try {
          const { output, messageId, liveMessageId, blockedQuestion } =
            await runDelegatedTask({
              taskId: childTask.id,
              agentId: employeeId,
              conversationId,
              instructions,
              emit,
              signal,
              onFollowUp
            })
          // Persist the employee's final output as a chat bubble — a coding
          // agent's step saved its own as it began (its card lives there).
          if (!messageId)
            await createConversationMessage({
              id: liveMessageId,
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
              output,
              ...(blockedQuestion
                ? { status: 'pending', note: `Needs PM: ${blockedQuestion}` }
                : {})
            })
            if (blockedQuestion)
              emit({
                type: 'plan_step_updated',
                conversationId,
                stepId,
                patch: {
                  status: 'pending',
                  note: `Needs PM: ${blockedQuestion}`,
                  output
                }
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
    createRecruitEmployeeTool(
      recruitmentModelOptions(setting),
      async ({ role, skills, name, provider, model: employeeModel }) => {
        const emp = await autoCreateEmployee({
          role,
          skills,
          name,
          provider,
          model: employeeModel
        })
        await joinGroup(emp.id)
        roster.push({
          id: emp.id,
          name: emp.name,
          description: emp.description,
          provider: emp.provider,
          model: emp.model
        })
        return {
          id: emp.id,
          name: emp.name,
          provider: emp.provider,
          model: emp.model
        }
      }
    ),
    createWaitForQuotaTool(async ({ stepId, employeeId, reason }) => {
      const emp = employees.find((e) => e.id === employeeId)
      const w =
        emp && isCliId(emp.runtime)
          ? blockedUntil(getQuota(emp.runtime), emp.model)
          : null
      if (!emp || !w)
        return 'Refused: nothing blocks that employee right now — delegate the step instead.'
      const cur = await getActivePlanByConversationId(conversationId)
      const planned =
        cur && cur.plan.status === 'active'
          ? cur.steps.find((st) => st.id === stepId)
          : undefined
      if (!planned)
        return `Refused: no step ${stepId} in this group's active plan.`
      const runAt = quotaWaitRunAt(w.resetsAt, Date.now())
      // The wake-up first: a step must never say it waits with none scheduled.
      // One wait per step: a second call moves the wake-up it already has.
      const existing = (await getUpcomingOneOffTasks()).find((t) => {
        const input = t.input as Record<string, unknown> | null
        return (
          t.conversationId === conversationId &&
          input?.kind === 'quota-wait' &&
          input?.stepId === stepId
        )
      })
      if (existing) await updateTask(existing.id, { runAt })
      else
        await createTask({
          conversationId,
          title: `Quota reset — continue "${planned.title}"`,
          description: `${reason}\nThe quota that stopped ${emp.name} should have reset. Read the quota lines, then continue the plan from step ${stepId}.`,
          status: 'pending',
          priority: 'medium',
          assignedAgentId: null,
          input: { kind: 'quota-wait', stepId, employeeId },
          output: null,
          runAt,
          maxRetries: 1,
          retryCount: 0
        })
      const note = `waiting for ${emp.name}'s ${quotaWindowLabel(w)} quota — ${reason}`
      const step = await updateStep(stepId, { status: 'pending', note })
      emit({
        type: 'plan_step_updated',
        conversationId,
        stepId,
        patch: { status: step.status, note: step.note }
      })
      await mirrorActivePlan()
      return `Step parked. You will be woken at ${formatWhen(runAt)}. End your turn now with one line for the owner saying what waits and why.`
    }),
    createWatchForTool(
      async ({ stepId, path, intervalSec, deadline, reason }) => {
        if (path.startsWith('/') || path.split('/').includes('..'))
          return 'Refused: watch paths must stay inside the Group workspace.'
        const until = new Date(deadline)
        if (
          !Number.isFinite(until.getTime()) ||
          until.getTime() <= Date.now() ||
          until.getTime() > Date.now() + 24 * 60 * 60_000
        )
          return 'Refused: deadline must be within the next 24 hours.'
        const planned = activePlan?.steps.find((step) => step.id === stepId)
        if (!planned)
          return `Refused: no step ${stepId} in this group's active plan.`
        await createTask({
          conversationId,
          title: `Watch — continue "${planned.title}"`,
          description: reason,
          status: 'pending',
          priority: 'medium',
          assignedAgentId: null,
          input: {
            kind: 'watch',
            stepId,
            path,
            intervalSec: Math.max(60, intervalSec),
            deadline: until.toISOString()
          },
          output: null,
          runAt: new Date(Date.now() + Math.max(60, intervalSec) * 1000),
          maxRetries: 1,
          retryCount: 0
        })
        const step = await updateStep(stepId, {
          status: 'pending',
          note: `watching ${path} — ${reason}`
        })
        emit({
          type: 'plan_step_updated',
          conversationId,
          stepId,
          patch: { status: step.status, note: step.note }
        })
        await mirrorActivePlan()
        return `Step parked. Watching ${path} until ${formatWhen(until)}.`
      }
    ),
    ...(kb ? [searchKnowledgeBase(kb, setting.knowledgeBase)] : []),
    ...(mcpServers.length > 0 ? mcpToolbox(mcpServers) : []),
    archiveOutput(workspace.dir, (entry) => {
      if (!pendingArchives.some((item) => item.path === entry.path))
        pendingArchives.push(entry)
    }),
    // The question is saved in the group (group-questions.ts): it stays in
    // the transcript, and survives a restart as one the owner can still answer.
    createEscalateToUserTool(({ question, options }) =>
      askOwner({ conversationId, question, options, signal, emit })
    )
  ]

  const userMessage: Message = {
    role: 'user',
    content: buildUserContent(
      withGroupMentions(userText, args.mentions),
      attachments
    ),
    timestamp: Date.now()
  }

  const mcpDirectoryText = mcpServers.length > 0 ? mcpDirectory(mcpServers) : ''
  const pmSystemPrompt =
    PM_SYSTEM_PROMPT +
    workspace.prompt +
    `\n\nEmployees:\n${rosterText(employees, teamNameById)}` +
    (quotaText ? `\n\nQuota:\n${quotaText}` : '') +
    (planText ? `\n\n${planText}` : '') +
    (mcpServers.length > 0 ? pmMcpSection(mcpDirectoryText) : '')
  const contextMessages: Message[] = [
    ...(history as Message[]).filter((m) => m.role !== 'system'),
    userMessage
  ]
  const contextKinds: ContextMessageKind[] = contextMessages.map((message) =>
    Array.isArray(message.content) &&
    message.content.some(
      (part) => part.type === 'text' && part.text.startsWith('<ph_summary ')
    )
      ? 'summary'
      : 'message'
  )

  const messageId = uuidV4()
  emit({ type: 'message_start', conversationId, messageId, role: 'pm' })

  // The round's decision trail (spec 2026-10-17): passive capture, never in
  // the round's way — the recorder logs its own failures, and `safe` is a
  // second net around every call into it.
  const recorder = createRoundRecorder(conversationId, uuidV4())
  const lcmTokens = lcmEnabled
    ? (await lcm.contextUsage(excludeMessageId)) +
      estimateMessageTokens(userMessage.content)
    : null
  recorder.context({
    model: model.id,
    contextWindow,
    compactAt: lcmEnabled
      ? Math.floor((contextWindow * contextWindowPercent) / 100)
      : null,
    lcmTokens,
    parts: measureContext({
      systemPrompt: pmSystemPrompt,
      skillsIndex: '',
      mcpDirectory: mcpDirectoryText,
      tools,
      memoryTexts: [],
      messages: contextMessages,
      kinds: contextKinds
    })
  })
  const safe = (f: () => void) => {
    try {
      f()
    } catch (error) {
      logger.warn('philharmonic', 'decision trail capture failed', {
        conversationId,
        error
      })
    }
  }
  // The reports this round reads: employee rows since the last round began.
  // That moment is read before this round's own input is written, which
  // would otherwise be the newest.
  let since: Date | null = null
  try {
    since = await lastRoundStartedAt(conversationId)
  } catch (error) {
    logger.warn('philharmonic', 'decision trail reports failed', {
      conversationId,
      error
    })
  }
  safe(() => recorder.input(args.trigger ?? 'user', userText))
  try {
    const names = new Map(employees.map((e) => [e.id, e.name]))
    const rows = await getMessagesByConversationId(conversationId)
    // A group whose rounds predate the trail has no `input` event: its
    // newest PM message stands for the last round, so its first recorded
    // round does not list every report the group ever had.
    const from = since ?? newestPmMessageAt(rows)
    const read = rows.filter(
      (r) => r.role === 'employee' && (!from || r.createdAt > from)
    )
    safe(() =>
      recorder.reports(
        read.map((r) => ({
          messageId: r.id,
          agentId: r.agentId,
          name: (r.agentId && names.get(r.agentId)) || 'former employee'
        }))
      )
    )
  } catch (error) {
    logger.warn('philharmonic', 'decision trail reports failed', {
      conversationId,
      error
    })
  }

  let finalText = ''
  let lastTurnHadTools = true
  try {
    const stream = agentLoop(
      [userMessage as AgentMessage],
      {
        // pi 1.0: the system prompt and the tool declarations lead the
        // transcript as a system message, ahead of the history.
        messages: [
          {
            role: 'system',
            content: pmSystemPrompt,
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
        getApiKey: () => router.current.apiKey,
        prepareRequest: ({ context }) => {
          const currentModel = router.current.model
          const messages = context.messages.filter(
            (m): m is Message => m.role !== 'system'
          )
          router.observe(
            messages.reduce((n, m) => n + estimateMessageTokens(m.content), 0)
          )
          const window = trustedContextWindow(currentModel) || 128_000
          recorder.context({
            model: currentModel.id,
            contextWindow: window,
            compactAt: lcmEnabled
              ? Math.floor((window * contextWindowPercent) / 100)
              : null,
            lcmTokens: null,
            parts: measureContext({
              systemPrompt: pmSystemPrompt,
              skillsIndex: '',
              mcpDirectory: mcpDirectoryText,
              tools,
              memoryTexts: [],
              messages,
              kinds: messages.map(() => 'message')
            })
          })
          return { model: currentModel }
        },
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
        beforeToolCall: async (context) =>
          Promise.resolve(
            budget.before(context) ??
              groupBeforeToolCall(conversationId, workspace.dir)(context)
          ),
        afterToolCall: async (context) => budget.after(context),
        finishTurn: async () =>
          budget.reason ? { action: 'end' as const } : undefined,
        getSteeringMessages: async () => {
          const pending = pmRunRegistry.takeSteering(conversationId)
          if (!pending.length && !lastTurnHadTools)
            pmRunRegistry.closeSteering(conversationId)
          return pending.map((input) => ({
            role: 'user' as const,
            content: buildUserContent(
              withGroupMentions(input.text, input.mentions),
              input.attachments
            ),
            timestamp: Date.now()
          }))
        }
      },
      signal,
      streamFn
    )

    for await (const event of stream) {
      safe(() => recorder.onEvent(event))
      if (event.type === 'message_update') {
        const msg = event.message as Message
        if (msg.role !== 'assistant') continue
        finalText = msg.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('')
        const thinking = msg.content
          .filter(
            (c): c is { type: 'thinking'; thinking: string } =>
              c.type === 'thinking' && 'thinking' in c
          )
          .map((c) => c.thinking)
          .join('')
        emit({
          type: 'message_delta',
          conversationId,
          messageId,
          delta: finalText,
          ...(thinking ? { thinking } : {})
        })
      } else if (event.type === 'message_end') {
        const msg = event.message as Message & { role: 'assistant' }
        if (msg.role === 'assistant')
          lastTurnHadTools = msg.content.some(
            (part) => part.type === 'toolCall'
          )
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
    pmRunRegistry.closeSteering(conversationId)
    const isAbort =
      (err instanceof Error && err.name === 'AbortError') ||
      signal?.aborted === true
    const message = err instanceof Error ? err.message : String(err)

    safe(() => recorder.error(message, isAbort))
    const counts = await recorder.finish()
    const decision = { kind: 'decision' as const, ...counts }

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
        id: messageId,
        conversationId,
        role: 'system',
        content: '⚠️ PM run was interrupted by the user.',
        roundId: recorder.roundId,
        parts: [decision]
      })
      emit({ type: 'message_end', conversationId, messageId })
      emit({ type: 'pm_ended', conversationId, reason: 'aborted' })
      return
    }

    logger.error('philharmonic', 'PM round failed', {
      conversationId,
      roundId: recorder.roundId,
      error: err
    })
    emit({ type: 'conversation_error', conversationId, error: message })
    await createConversationMessage({
      id: messageId,
      conversationId,
      role: 'system',
      content: `⚠️ PM error: ${message}`,
      roundId: recorder.roundId,
      parts: [decision]
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
  } finally {
    await closeAutomationTools(operationalTools)
  }

  if (budget.reason) finalText = budget.reason
  pmRunRegistry.closeSteering(conversationId)
  const final = await getActivePlanByConversationId(conversationId)
  const finalOutput =
    !budget.reason &&
    (!final ||
      final.plan.status !== 'active' ||
      (final.steps.length > 0 &&
        final.steps.every(
          (step) => step.status === 'done' || step.status === 'skipped'
        )))
  // The collapsed decision disclosure reads its counts from this part, so a
  // closed one fetches nothing.
  const counts = await recorder.finish()
  // Under the id the answer streamed with: the live bubble and the row are
  // one message, never two (the transcript drops a bubble once its row loads).
  await createConversationMessage({
    id: messageId,
    conversationId,
    role: 'pm',
    content: finalText,
    roundId: recorder.roundId,
    parts: [
      ...pendingArchives,
      ...(finalOutput ? [{ kind: 'final_output' as const }] : []),
      { kind: 'decision', ...counts }
    ]
  })
  if (titlePromise) {
    try {
      const title = await titlePromise
      const updated = await updateConversationTitleIfUnchanged(
        conversationId,
        defaultGroupTitle,
        title
      )
      if (updated) {
        conversationTitle = updated.title
      }
    } catch (error) {
      logger.warn('philharmonic', 'Failed to generate the Group title', {
        conversationId,
        error
      })
    }
  }
  emit({
    type: 'message_end',
    conversationId,
    messageId,
    ...(conversationTitle !== defaultGroupTitle ? { conversationTitle } : {})
  })

  // Auto-close the plan when every step has reached a terminal state. The PM
  // doesn't need to ceremoniously declare the plan done — finishing the turn
  // without follow-up tools implies it.
  let notifiedCompletion = false
  if (final && final.plan.status === 'active' && final.steps.length > 0) {
    const allTerminal = final.steps.every(
      (s) => s.status === 'done' || s.status === 'skipped'
    )
    if (allTerminal) {
      await updatePlanStatus(final.plan.id, 'completed')
      emit({
        type: 'plan_status_changed',
        conversationId,
        status: 'completed'
      })
      await mirrorActivePlan()
      notifiedCompletion = true
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

  if (!notifiedCompletion) {
    notifyIfBackground({
      title: mainT(
        'menu:notification.philharmonicRoundFinished',
        'Group "{{title}}" finished a round',
        { title: conversationTitle }
      ),
      body: conversationTitle
    })
  }

  // Fire-and-forget LCM compaction. Errors are caught inside trackAndCompact
  // so we don't crash the turn we just finished. Next turn's assembleContext
  // will pick up the new summary if compaction lands first.
  lcm.trackAndCompact().catch(() => {})

  emit({ type: 'pm_ended', conversationId, reason: 'done' })
}

/** The `createdAt` of the newest `pm` row, or null when the PM never spoke. */
function newestPmMessageAt(
  rows: { role: string; createdAt: Date }[]
): Date | null {
  let at: Date | null = null
  for (const r of rows)
    if (r.role === 'pm' && (!at || r.createdAt > at)) at = r.createdAt
  return at
}
