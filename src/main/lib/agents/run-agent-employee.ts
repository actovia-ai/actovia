// src/main/lib/agents/run-agent-employee.ts
import type {
  AgentCard,
  CliId,
  CliQuota,
  CliStatus,
  PermissionMode
} from '@actovia/shared/types/agents'
import { CLI_NAMES } from '@actovia/shared/types/agents'
import { v4 as uuidV4 } from 'uuid'

import type { SseEmitter } from '../ai/philharmonic/employee-loop'
import {
  createAgentSession,
  findResumableSession,
  updateAgentSession
} from '../db/agent-session-queries'
import {
  createConversationMessage,
  getConversationById,
  updateConversationMessageContent,
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
import { getCliStatus } from './cli-check'
import type { AgentRun, StartInput } from './driver'
import { DRIVERS, cliOf } from './drivers'
import { loginShellEnv } from './login-shell'
import { assertMetaDir } from './meta-files'
import { prepareWorkDir, sessionLogPath, writeSessionMeta } from './projects'
import { recordQuota } from './quota'
import { type AgentRegistry, agentRegistry } from './registry'
import { agentSettings } from './settings'

export interface DelegatedOutput {
  output: string
  /** A CLI step's own message, saved as the step began; the PM saves no other. */
  messageId?: string
  /** Actovia's own loop: the id its bubble streamed under, which the saved
   * report takes so the live bubble and the row are one message. */
  liveMessageId?: string
  /** A CLI step's own turn: its tokens. Absent when the CLI says nothing. */
  usage?: { inputTokens: number; outputTokens: number }
}

export interface RunAgentEmployeeArgs {
  /** Persisted CLI follow-up reports, delivered after the delegated turn has returned. */
  onFollowUp?: (outcome: DelegatedOutput) => Promise<void>
  agent: Agent
  instructions: string
  taskId: string
  conversationId: string
  emit: SseEmitter
  signal?: AbortSignal
}

export interface RunAgentEmployeeDeps {
  start(cli: CliId, input: StartInput): AgentRun
  registry: AgentRegistry
  cliStatus(cli: CliId): Promise<CliStatus>
  env(): Promise<Record<string, string>>
  /** Every `quota` event of a process, for the life of the process (spec 2026-10-16 §3). */
  recordQuota(q: CliQuota, merge: boolean): void
}

const defaultDeps: RunAgentEmployeeDeps = {
  start: (cli, input) => DRIVERS[cli].start(input),
  registry: agentRegistry,
  cliStatus: (cli) => getCliStatus(cli),
  env: loginShellEnv,
  recordQuota: (q, merge) => recordQuota(q, { merge })
}

const THROTTLE_MS = 40

/** The step whose listener owns a run's events; a newer step retires the older listener. */
const stepOwner = new WeakMap<AgentRun, object>()

export function formatAgentOutput(card: AgentCard, sessionId: string): string {
  const lines = [
    `[${CLI_NAMES[card.runtime]} · ${card.state}]`,
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

/**
 * The step's message, kept current: writes go out one at a time, in order,
 * and a card queued behind a write is replaced by a newer one, never
 * written stale. A failed write is logged; the next one carries the card.
 */
function messageWriter(messageId: string) {
  let chain = Promise.resolve()
  let nextCard: AgentCard | null = null
  const run = (write: () => Promise<void>) => {
    chain = chain.then(() =>
      write().catch((error: Error) =>
        logger.warn('agents', 'card persist failed', {
          messageId,
          message: error.message
        })
      )
    )
  }
  return {
    card(card: AgentCard) {
      const queued = nextCard !== null
      nextCard = card
      if (queued) return
      run(() => {
        const latest = nextCard!
        nextCard = null
        return updateConversationMessageParts(messageId, [
          latest as unknown as Record<string, unknown>
        ])
      })
    },
    content(text: string) {
      run(() => updateConversationMessageContent(messageId, text))
    },
    settled: () => chain
  }
}

export async function runAgentEmployee(
  args: RunAgentEmployeeArgs,
  deps: RunAgentEmployeeDeps = defaultDeps
): Promise<DelegatedOutput> {
  const {
    agent,
    instructions,
    taskId,
    conversationId,
    emit,
    signal,
    onFollowUp
  } = args
  const cli = cliOf(agent.runtime)
  const name = CLI_NAMES[cli]
  const conversation = await getConversationById(conversationId)
  const project = conversation?.projectId
    ? await getProjectById(conversation.projectId)
    : undefined
  if (!project)
    throw new Error(
      `This group has no folder. Choose one in the composer before giving ${name} a step.`
    )
  const status = await deps.cliStatus(cli)
  if (status.state !== 'ready' || !status.path) {
    throw new Error(
      `${name} is not ready (${status.state}): ${status.detail ?? ''}`.trim()
    )
  }
  const binPath = status.path
  const key = `${project.id}:${agent.id}`

  return deps.registry.queue(key, async () => {
    // Before any await: a parallel step in this project must see this one.
    const unclaim = deps.registry.claimProject(project.id)
    const othersInProject =
      deps.registry.claimsInProject(project.id) > 1 ||
      deps.registry.runningInProject(project.id) > 0
    // The card's one home, from the start: the live events and the saved row share this id.
    const messageId = uuidV4()
    const writer = messageWriter(messageId)
    let saved = false
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
    let followUpActive = false
    let reports = Promise.resolve()
    let stepUsage: DelegatedOutput['usage']
    /** This step started the process, and its first turn began. */
    let startedHere = false
    let began = false
    let forgetThread = false

    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = null
      lastEmit = Date.now()
      if (!card) return
      const event = {
        type: 'agent_card' as const,
        conversationId,
        messageId,
        card
      }
      // After the step the PM's stream may be over; the group's still listens.
      if (stepDone) emitToConversation(conversationId, event)
      else emit(event)
      if (saved) writer.card(card)
    }
    const throttled = () => {
      const wait = THROTTLE_MS - (Date.now() - lastEmit)
      if (wait <= 0) return flush()
      timer ??= setTimeout(flush, wait)
    }

    try {
      // The session row first: its id names the worktree and the log. It
      // points at this step's message from now on (stale cards, Terminal).
      const found = await findResumableSession(project.id, agent.id)
      // Another CLI's session (the employee was switched) is not resumed.
      const previous = found?.runtime === cli ? found : undefined
      const session = previous
        ? await updateAgentSession(previous.id, {
            state: 'working',
            continuedInTerminal: false,
            conversationId,
            messageId
          })
        : await (async () => {
            const id = uuidV4()
            const othersRunning =
              othersInProject && (await agentSettings()).worktrees
            const w = await prepareWorkDir(project, id, othersRunning)
            return createAgentSession({
              id,
              projectId: project.id,
              agentId: agent.id,
              conversationId,
              messageId,
              runtime: cli,
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
          runtime: cli,
          model: agent.model ?? null,
          projectName: project.name,
          cwd: session.cwd,
          branch: session.branch ?? null
        }),
        queued: true
      }
      // Saved before anything can wait on the owner, so a prompt is never only an event.
      await createConversationMessage({
        id: messageId,
        conversationId,
        role: 'employee',
        agentId: agent.id,
        content: formatAgentOutput(card, session.id),
        parts: [card as unknown as Record<string, unknown>],
        taskId
      })
      flush()
      saved = true
      // A live process must not be idled out while this step waits for a slot.
      deps.registry.cancelIdleExit(key)
      release = await deps.registry.acquireSlot(signal)
      card = { ...card, queued: false }
      flush()

      let run = await deps.registry.liveFor(key, session.id, cli)
      if (run?.busy) {
        // Its unprompted turn's end must not answer this step; if it exits, start afresh.
        await turnSettled(run, signal)
        run = deps.registry.live(key)
      }
      if (!run) {
        startedHere = true
        await assertMetaDir(project, 'logs')
        run = deps.start(cli, {
          binPath,
          cwd: session.cwd,
          env: await deps.env(),
          model: agent.model,
          permissionMode:
            (agent.permissionMode as PermissionMode | null) ?? 'default',
          resume: previous?.cliSessionId ?? null,
          logPath: sessionLogPath(project, session.id)
        })
        deps.registry.attach(
          key,
          session.id,
          cli,
          project.id,
          conversationId,
          run
        )
        // Its own listener: the step's listener comes and goes, the process stays.
        run.on((e) => {
          if (e.type === 'quota') deps.recordQuota(e.quota, e.merge === true)
        })
      } else deps.registry.bindConversation(key, conversationId)

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
          if (stepDone && ['text', 'text_delta', 'step_start'].includes(e.type))
            card = { ...card!, state: 'working', error: null }
          card = applyAgentEvent(card!, e)
          if (stepDone) {
            // Quota/snapshot chatter is not a new employee report or a busy turn.
            if (e.type === 'quota' || e.type === 'background_tasks') return
            if (e.type !== 'turn_end' && e.type !== 'exit')
              followUpActive = true
            // An unprompted turn after the step (spec §2.1): keep the persisted card current.
            // It is still real work: don't let the first step's idle timer
            // tear the process down while Claude is finishing its follow-up.
            deps.registry.cancelIdleExit(key)
            if (e.type === 'turn_end' || e.type === 'exit') {
              flush()
              if (e.type === 'turn_end') {
                deps.registry.scheduleIdleExit(key)
                if (followUpActive) {
                  followUpActive = false
                  const output = formatAgentOutput(card!, session.id)
                  writer.content(output)
                  const persisted = writer.settled()
                  const state = card!.state
                  reports = reports
                    .then(async () => {
                      await persisted
                      if (stepOwner.get(liveRun) === owner && !liveRun.busy)
                        await setSession(project, session.id, { state })
                      if (!e.interrupted && !signal?.aborted)
                        await onFollowUp?.({ output, messageId })
                    })
                    .catch((error) =>
                      logger.warn('agents', 'follow-up report failed', {
                        taskId,
                        error
                      })
                    )
                }
              }
            } else throttled()
            if (e.type === 'exit') off()
            return
          }
          switch (e.type) {
            case 'init':
              began = true
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
              flush()
              if (card!.prompts.length === 0) {
                void updateTask(taskId, { status: 'running' })
                void setSession(project, session.id, { state: 'working' })
              }
              break
            case 'turn_end':
              flush()
              if (e.usage)
                stepUsage = {
                  inputTokens: e.usage.inputTokens,
                  outputTokens: e.usage.outputTokens
                }
              stepDone = true
              resolve()
              break
            case 'exit':
              // It never got as far as a turn (a refused resume, a failed
              // start): the next step starts a fresh thread (spec §7).
              if (startedHere && !began && !e.expected) forgetThread = true
              flush()
              off()
              reject(new Error(card!.error ?? `${name} stopped`))
              break
            default:
              throttled()
          }
        })
      })

      const onAbort = () => liveRun.interrupt()
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        if (!liveRun.send(prompt)) throw new Error(`${name} is not running`)
        // An abort between the slot and the listener above would be missed.
        if (signal?.aborted) onAbort()
        await result
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
      return {
        output: formatAgentOutput(card, session.id),
        messageId,
        ...(stepUsage ? { usage: stepUsage } : {})
      }
    } finally {
      unclaim()
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
          flush()
        }
        await setSession(project, sessionId, {
          state,
          ...(forgetThread ? { cliSessionId: null } : {})
        })
      }
      // What the PM reads, also in the row its history is built from.
      if (saved && card && sessionId)
        writer.content(formatAgentOutput(card, sessionId))
      await writer.settled()
      emit({ type: 'message_end', conversationId, messageId })
      deps.registry.scheduleIdleExit(key)
    }
  })
}
