import { BASE_URL } from '@actovia/shared/constants/systems'
import type { AgentCard } from '@actovia/shared/types/agents'
import type {
  PhilharmonicSseEvent,
  PlanDto,
  StepDto,
  StepPatch
} from '@actovia/shared/types/philharmonic'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { recordAgentCard } from '@/lib/agent-card'
import { getActivePlan } from '@/services/philharmonic-chat'

import { emptyBusyState, reduceBusy, type BusyState } from './busy-reducer'

export interface LiveBubble {
  messageId: string
  role: string
  agentId?: string
  text: string
  done: boolean
  toolCards: Array<{
    toolName: string
    phase: 'start' | 'end'
    result?: unknown
  }>
  /** A coding agent's run, for an employee message driven by a CLI. */
  agentCard?: AgentCard
}

export interface RetryNotice {
  /** monotonic id so callers can deduplicate */
  id: number
  taskId: string
  attempt: number
  delayMs: number
  error: string
}

export interface ConversationStream {
  bubbles: LiveBubble[]
  askUser: { question: string; options: string[] } | null
  error: string | null
  /** bumps whenever a message_end / member_joined arrives so the page can refetch */
  revision: number
  /** Current execution plan, or null if none yet. Live-updated from SSE. */
  plan: PlanDto | null
  /** Most recent retry notification (used for inline UI hints / logs). */
  lastRetry: RetryNotice | null
  /** True while the PM is actively driving a turn — drives the Stop button. */
  pmRunning: boolean
  /** actorId → activity label. Presence means "busy". '__pm__' for the PM. */
  busyAgents: ReadonlyMap<string, string>
  /** messageId → the latest card seen live; it keeps a persisted message's
   * card current after the message itself has been saved. Keyed by message:
   * an employee's next step resumes the same session in a new message. */
  agentCards: Record<string, AgentCard>
}

function applyStepPatch(step: StepDto, patch: StepPatch): StepDto {
  return {
    ...step,
    ...patch,
    output: patch.output === undefined ? step.output : patch.output,
    note: patch.note === undefined ? step.note : patch.note,
    assignedAgentId:
      patch.assignedAgentId === undefined
        ? step.assignedAgentId
        : patch.assignedAgentId
  }
}

export function useConversationStream(
  conversationId: string | null
): ConversationStream {
  const { t } = useTranslation('philharmonic')
  const [bubbles, setBubbles] = useState<LiveBubble[]>([])
  const [askUser, setAskUser] = useState<ConversationStream['askUser']>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [plan, setPlan] = useState<PlanDto | null>(null)
  const [lastRetry, setLastRetry] = useState<RetryNotice | null>(null)
  const retryCounter = useRef(0)
  const [pmRunning, setPmRunning] = useState(false)
  const [busy, setBusy] = useState<BusyState>(emptyBusyState)
  const [agentCards, setAgentCards] = useState<Record<string, AgentCard>>({})

  // Pull the current plan on mount / conversation switch so users coming back
  // to a Group after closing the panel see the latest state. SSE events
  // continue to mutate `plan` from here on.
  //
  // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- Intentional:
  // setPlan(null) is not copying a prop into state — it clears ephemeral plan
  // state when the conversation is deselected. Using `key` on the parent would
  // force a full unmount/remount of the SSE EventSource, causing a reconnect
  // storm. The effect runs once per conversationId change, which is correct.
  useEffect(() => {
    if (!conversationId) {
      setPlan(null)
      return
    }
    let cancelled = false
    getActivePlan(conversationId)
      .then((p) => {
        if (!cancelled) setPlan(p)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [conversationId])

  // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- Intentional:
  // All six setState calls here reset ephemeral SSE-streaming state (live
  // bubbles, ask-user prompt, error, PM-running flag, busy map, agent cards) when switching
  // to a different conversation. This is required — the old conversation's
  // in-flight data must not bleed into the new one. The alternative (passing
  // conversationId as `key`) would unmount/remount the EventSource on every
  // switch, causing unnecessary reconnects. The current pattern is the correct
  // approach for streaming-state-sensitive hooks.
  useEffect(() => {
    if (!conversationId) return
    setBubbles([])
    setAskUser(null)
    setError(null)
    setPmRunning(false)
    setBusy(emptyBusyState())
    setAgentCards({})

    const source = new EventSource(
      `${BASE_URL}/api/v1/philharmonic/conversations/${conversationId}/sse`
    )
    source.onmessage = (e) => {
      let evt: PhilharmonicSseEvent
      try {
        evt = JSON.parse(e.data) as PhilharmonicSseEvent
      } catch {
        return
      }
      if (!('conversationId' in evt) || evt.conversationId !== conversationId)
        return

      // Aggregate every event through the busy reducer; it's a pure function
      // so unrelated events just pass through unchanged.
      setBusy((prev) => reduceBusy(prev, evt))

      switch (evt.type) {
        case 'message_start':
          setBubbles((prev) => [
            ...prev,
            {
              messageId: evt.messageId,
              role: evt.role,
              agentId: evt.agentId,
              text: '',
              done: false,
              toolCards: []
            }
          ])
          // PM resuming after an askUser response → clear the panel.
          setAskUser(null)
          break
        case 'message_delta':
          setBubbles((prev) =>
            prev.map((b) =>
              b.messageId === evt.messageId ? { ...b, text: evt.delta } : b
            )
          )
          break
        case 'message_end':
          setBubbles((prev) =>
            prev.map((b) =>
              b.messageId === evt.messageId ? { ...b, done: true } : b
            )
          )
          setRevision((r) => r + 1)
          break
        case 'tool_card':
          setBubbles((prev) =>
            prev.map((b) =>
              b.messageId === evt.messageId
                ? {
                    ...b,
                    toolCards: [
                      ...b.toolCards,
                      {
                        toolName: evt.toolName,
                        phase: evt.phase,
                        result: evt.result
                      }
                    ]
                  }
                : b
            )
          )
          break
        case 'agent_card':
          setAgentCards((prev) =>
            recordAgentCard(prev, evt.messageId, evt.card)
          )
          setBubbles((prev) =>
            prev.map((b) =>
              b.messageId === evt.messageId ? { ...b, agentCard: evt.card } : b
            )
          )
          break
        case 'member_joined':
          setRevision((r) => r + 1)
          break
        case 'ask_user':
          setAskUser({ question: evt.question, options: evt.options })
          break
        case 'conversation_error':
          setError(evt.error)
          // Bubble to the app shell so users see it even when the panel is
          // closed. The inline error block in GroupChat is still rendered.
          sileo.error({
            title: t('chat.groupChat.errorTitle'),
            description:
              evt.error.length > 200 ? `${evt.error.slice(0, 197)}…` : evt.error
          })
          break
        case 'pm_started':
          setPmRunning(true)
          break
        case 'pm_ended':
          setPmRunning(false)
          break
        case 'delegation_retry':
          retryCounter.current += 1
          setLastRetry({
            id: retryCounter.current,
            taskId: evt.taskId,
            attempt: evt.attempt,
            delayMs: evt.delayMs,
            error: evt.error
          })
          break
        case 'plan_created':
          setPlan(evt.plan)
          break
        case 'plan_step_updated':
          setPlan((prev) =>
            prev
              ? {
                  ...prev,
                  steps: prev.steps.map((s) =>
                    s.id === evt.stepId ? applyStepPatch(s, evt.patch) : s
                  )
                }
              : prev
          )
          break
        case 'plan_step_appended':
          setPlan((prev) =>
            prev ? { ...prev, steps: [...prev.steps, evt.step] } : prev
          )
          break
        case 'plan_status_changed':
          setPlan((prev) => (prev ? { ...prev, status: evt.status } : prev))
          break
      }
    }
    return () => source.close()
  }, [conversationId])

  return {
    bubbles,
    askUser,
    error,
    revision,
    plan,
    lastRetry,
    pmRunning,
    busyAgents: busy.busyAgents,
    agentCards
  }
}
