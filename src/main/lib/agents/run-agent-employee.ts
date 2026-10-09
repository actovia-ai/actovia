// src/main/lib/agents/run-agent-employee.ts
import type {
  AgentCard,
  CliStatus,
  PermissionMode
} from '@exodus/shared/types/agents'
import { CLI_NAMES } from '@exodus/shared/types/agents'
import { v4 as uuidV4 } from 'uuid'

import type { SseEmitter } from '../ai/philharmonic/employee-loop'
import {
  createAgentSession,
  findResumableSession,
  getAgentSession,
  updateAgentSession
} from '../db/agent-session-queries'
import {
  getConversationById,
  updateConversationMessageParts
} from '../db/conversation-queries'
import { updateTask } from '../db/philharmonic-queries'
import { getProjectById } from '../db/project-queries'
import type { Agent, AgentSession, Project } from '../db/schema'
import { mainT } from '../i18n'
import { logger } from '../logger'
import { notifyIfBackground } from '../philharmonic-notifications'
import { emitToConversation } from '../server/routes/philharmonic-sse'
import { applyAgentEvent, cardText, newCard, touchedFiles } from './card'
import { startClaudeCode } from './claude-code/run'
import { getCliStatus } from './cli-check'
import type { AgentRun, StartInput } from './driver'
import { loginShellEnv } from './login-shell'
import { assertMetaDir } from './meta-files'
import { prepareWorkDir, sessionLogPath, writeSessionMeta } from './projects'
import { type AgentRegistry, agentRegistry } from './registry'
import { agentSettings } from './settings'

export interface DelegatedOutput {
  output: string
  parts?: Record<string, unknown>[]
  sessionId?: string
}

export interface RunAgentEmployeeArgs {
  agent: Agent
  instructions: string
  taskId: string
  conversationId: string
  emit: SseEmitter
  signal?: AbortSignal
}

export interface RunAgentEmployeeDeps {
  start(input: StartInput): AgentRun
  registry: AgentRegistry
  cliStatus(): Promise<CliStatus>
  env(): Promise<Record<string, string>>
}

const defaultDeps: RunAgentEmployeeDeps = {
  start: startClaudeCode,
  registry: agentRegistry,
  cliStatus: () => getCliStatus('claude-code'),
  env: loginShellEnv
}

const THROTTLE_MS = 40

/** The step whose listener owns a run's events; a newer step retires the older listener. */
const stepOwner = new WeakMap<AgentRun, object>()

export function formatAgentOutput(card: AgentCard, sessionId: string): string {
  const lines = [
    `[${CLI_NAMES['claude-code']} · ${card.state}]`,
    cardText(card) || '(no reply)'
  ]
  const files = touchedFiles(card)
  if (files.length > 0) lines.push(`Files changed: ${files.join(', ')}`)
  if (card.denials)
    lines.push(
      `The owner denied ${card.denials} request${card.denials === 1 ? '' : 's'}.`
    )
  lines.push(`Session: ${sessionId}`)
  return lines.join('\n')
}

export const agentCardMessageText = (card: AgentCard) => cardText(card)

/**
 * Wait out a turn the process is in (an unprompted one): its listener keeps
 * folding it into the previous message until its `turn_end` or `exit`.
 */
function turnSettled(run: AgentRun, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      off()
      signal?.removeEventListener('abort', onAbort)
    }
    const off = run.on((e) => {
      if (e.type !== 'turn_end' && e.type !== 'exit') return
      done()
      resolve()
    })
    const onAbort = () => {
      done()
      reject(signal!.reason)
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Session meta is a mirror for the folder; a failed write never fails the step. */
async function setSession(
  project: Project,
  id: string,
  data: Partial<AgentSession>
): Promise<AgentSession | undefined> {
  try {
    const row = await updateAgentSession(id, data)
    await writeSessionMeta(project, row)
    return row
  } catch (error) {
    logger.warn('agents', 'session update failed', {
      sessionId: id,
      message: (error as Error).message
    })
    return undefined
  }
}

/** After the step: the card's later updates go to the message the PM saved for it. */
async function persistCard(
  sessionId: string | null,
  conversationId: string,
  card: AgentCard
): Promise<void> {
  const row = sessionId ? await getAgentSession(sessionId) : undefined
  if (!row?.messageId) return
  await updateConversationMessageParts(row.messageId, [
    card as unknown as Record<string, unknown>
  ])
  emitToConversation(conversationId, {
    type: 'agent_card',
    conversationId,
    messageId: row.messageId,
    card
  })
}

export async function runAgentEmployee(
  args: RunAgentEmployeeArgs,
  deps: RunAgentEmployeeDeps = defaultDeps
): Promise<DelegatedOutput> {
  const { agent, instructions, taskId, conversationId, emit, signal } = args
  const conversation = await getConversationById(conversationId)
  const project = conversation?.projectId
    ? await getProjectById(conversation.projectId)
    : undefined
  if (!project)
    throw new Error(
      'This group has no folder. Choose one in the composer before giving Claude Code a step.'
    )
  const status = await deps.cliStatus()
  if (status.state !== 'ready' || !status.path) {
    throw new Error(
      `Claude Code is not ready (${status.state}): ${status.detail ?? ''}`.trim()
    )
  }
  const binPath = status.path
  const key = `${project.id}:${agent.id}`

  return deps.registry.queue(key, async () => {
    const messageId = uuidV4()
    emit({
      type: 'message_start',
      conversationId,
      messageId,
      role: 'employee',
      agentId: agent.id
    })
    let sessionId: string | null = null
    let card: AgentCard | null = null
    let release: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastEmit = 0
    /** Set once the step resolved: later (unprompted) turns update the persisted message. */
    let stepDone = false

    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = null
      lastEmit = Date.now()
      if (!card) return
      if (!stepDone) {
        emit({ type: 'agent_card', conversationId, messageId, card })
        return
      }
      void persistCard(sessionId, conversationId, card).catch((error: Error) =>
        logger.warn('agents', 'card persist failed', {
          sessionId,
          message: error.message
        })
      )
    }
    const throttled = () => {
      const wait = THROTTLE_MS - (Date.now() - lastEmit)
      if (wait <= 0) return flush()
      timer ??= setTimeout(flush, wait)
    }

    try {
      // The session row first: its id names the worktree and the log.
      const previous = await findResumableSession(project.id, agent.id)
      const session = previous
        ? await updateAgentSession(previous.id, {
            state: 'working',
            continuedInTerminal: false,
            conversationId
          })
        : await (async () => {
            const id = uuidV4()
            const othersRunning =
              (await agentSettings()).worktrees &&
              deps.registry.runningInProject(project.id) > 0
            const w = await prepareWorkDir(project, id, othersRunning)
            return createAgentSession({
              id,
              projectId: project.id,
              agentId: agent.id,
              conversationId,
              runtime: 'claude-code',
              cwd: w.cwd,
              branch: w.branch,
              state: 'working'
            })
          })()
      sessionId = session.id
      await writeSessionMeta(project, session)
      card = {
        ...newCard({
          sessionId: session.id,
          agentId: agent.id,
          runtime: 'claude-code',
          model: agent.model ?? null,
          projectName: project.name,
          cwd: session.cwd,
          branch: session.branch ?? null
        }),
        queued: true
      }
      flush()
      // A live process must not be idled out while this step waits for a slot.
      deps.registry.cancelIdleExit(key)
      release = await deps.registry.acquireSlot(signal)
      card = { ...card, queued: false }
      flush()

      let run = deps.registry.live(key)
      if (run?.busy) {
        // Its unprompted turn's end must not answer this step; if it exits, start afresh.
        await turnSettled(run, signal)
        run = deps.registry.live(key)
      }
      if (!run) {
        await assertMetaDir(project, 'logs')
        run = deps.start({
          binPath,
          cwd: session.cwd,
          env: await deps.env(),
          model: agent.model,
          permissionMode:
            (agent.permissionMode as PermissionMode | null) ?? 'default',
          resume: previous?.cliSessionId ?? null,
          logPath: sessionLogPath(project, session.id)
        })
        deps.registry.attach(key, session.id, project.id, run)
      }

      const liveRun = run
      const owner = {}
      stepOwner.set(liveRun, owner)
      const prompt = agent.systemPrompt?.trim()
        ? `${agent.systemPrompt.trim()}\n\n${instructions}`
        : instructions

      const result = new Promise<void>((resolve, reject) => {
        const off = liveRun.on((e) => {
          // A newer step on this process listens for itself now.
          if (stepOwner.get(liveRun) !== owner) {
            off()
            return
          }
          card = applyAgentEvent(card!, e)
          if (stepDone) {
            // An unprompted turn after the step (spec §2.1): keep the persisted card current.
            if (e.type === 'turn_end' || e.type === 'exit') flush()
            else throttled()
            if (e.type === 'exit') off()
            return
          }
          switch (e.type) {
            case 'init':
              void setSession(project, session.id, {
                cliSessionId: e.cliSessionId
              })
              throttled()
              break
            case 'blocked': {
              flush()
              void updateTask(taskId, { status: 'waiting_for_user' })
              void setSession(project, session.id, { state: 'blocked' })
              const p = e.prompt
              notifyIfBackground({
                title: mainT(
                  'menu:notification.agentWaiting',
                  '{{name}} is waiting for you',
                  { name: agent.name }
                ),
                body:
                  p.kind === 'permission'
                    ? p.summary || p.tool
                    : (p.questions[0]?.question ?? '')
              })
              break
            }
            case 'answered':
              throttled()
              if (card!.prompts.length === 0) {
                void updateTask(taskId, { status: 'running' })
                void setSession(project, session.id, { state: 'working' })
              }
              break
            case 'turn_end':
              flush()
              stepDone = true
              resolve()
              break
            case 'exit':
              flush()
              off()
              reject(new Error(card!.error ?? 'Claude Code stopped'))
              break
            default:
              throttled()
          }
        })
      })

      const onAbort = () => liveRun.interrupt()
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        if (!liveRun.send(prompt)) throw new Error('Claude Code is not running')
        // An abort between the slot and the listener above would be missed.
        if (signal?.aborted) onAbort()
        await result
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
      return {
        output: formatAgentOutput(card, session.id),
        parts: [card as unknown as Record<string, unknown>],
        sessionId: session.id
      }
    } finally {
      release?.()
      if (timer) clearTimeout(timer)
      timer = null
      if (sessionId) {
        const unfinished =
          !card || card.state === 'working' || card.state === 'blocked'
        // Stopped by the group (even while queued) is not a failure.
        const state = unfinished
          ? signal?.aborted
            ? 'stopped'
            : 'error'
          : card!.state
        if (card && unfinished && !stepDone) {
          card = { ...card, state, queued: false }
          emit({ type: 'agent_card', conversationId, messageId, card })
        }
        await setSession(project, sessionId, { state })
      }
      emit({ type: 'message_end', conversationId, messageId })
      deps.registry.scheduleIdleExit(key)
    }
  })
}
