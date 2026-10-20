import { ErrorCode } from '@actovia/shared/constants/error-codes'
import type {
  ApprovalOutcome,
  ApprovalRequiredEvent
} from '@actovia/shared/types/chat'
import { HttpError } from '@actovia/shared/utils/http'
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query'

import { i18n } from '@/lib/i18n'
import type { MutationMeta } from '@/lib/query-client'
import { decideApproval, type ApprovalDecision } from '@/services/chat'

/**
 * A tool call paused for the user's approval (`approval_required`), as the
 * run's foot shows it. Live-only: it arrives on the chat's stream and is not
 * persisted — once settled, the tool result says what happened.
 * `expired`: the server no longer had it when the answer arrived.
 */
export interface RunApproval {
  toolCallId: string
  toolName: string
  summary: string
  /** Set when `summary` was cut server-side (I1 follow-up): the card shows
   *  a "N more characters not shown" note instead of silently clipping it. */
  truncated?: boolean
  hiddenChars?: number
  expiresAt: number
  state: 'pending' | ApprovalOutcome | 'expired'
}

/** runId → that run's paused calls, in arrival order. */
type ChatApprovals = Record<string, RunApproval[]>

export const approvalKeys = {
  all: ['approvals'] as const,
  chat: (chatId: string) => ['approvals', chatId] as const
}

const NO_CHAT_APPROVALS: ChatApprovals = {}
const NO_APPROVALS: RunApproval[] = []

/** Nothing to fetch — the stream writes this cache — and nothing to drop
 *  while a call may still be waiting (the timeout is ten minutes). */
function ensureDefaults(client: QueryClient) {
  client.setQueryDefaults(approvalKeys.all, {
    staleTime: Infinity,
    gcTime: Infinity
  })
}

function updateRun(
  client: QueryClient,
  chatId: string,
  runId: string,
  update: (list: RunApproval[]) => RunApproval[]
) {
  ensureDefaults(client)
  client.setQueryData<ChatApprovals>(approvalKeys.chat(chatId), (old) => {
    const current = old ?? NO_CHAT_APPROVALS
    const next = update(current[runId] ?? NO_APPROVALS)
    return next === current[runId] ? current : { ...current, [runId]: next }
  })
}

function settle(
  client: QueryClient,
  chatId: string,
  runId: string,
  toolCallId: string,
  state: RunApproval['state']
) {
  updateRun(client, chatId, runId, (list) =>
    list.some((a) => a.toolCallId === toolCallId && a.state !== state)
      ? list.map((a) => (a.toolCallId === toolCallId ? { ...a, state } : a))
      : list
  )
}

/** `approval_required` from the stream. */
export function recordApprovalRequired(
  client: QueryClient,
  chatId: string,
  event: ApprovalRequiredEvent
) {
  updateRun(client, chatId, event.runId, (list) => [
    ...list.filter((a) => a.toolCallId !== event.toolCallId),
    {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      summary: event.summary,
      truncated: event.truncated,
      hiddenChars: event.hiddenChars,
      expiresAt: event.expiresAt,
      state: 'pending'
    }
  ])
}

/** `approval_resolved` from the stream — whoever answered (or the clock). */
export function recordApprovalResolved(
  client: QueryClient,
  chatId: string,
  event: { runId: string; toolCallId: string; outcome: ApprovalOutcome }
) {
  settle(client, chatId, event.runId, event.toolCallId, event.outcome)
}

/**
 * One run's paused calls. `select` narrows the chat's record to this run, so
 * a card re-renders only when its own run's approvals change.
 */
export function useRunApprovals(chatId: string, runId: string): RunApproval[] {
  const client = useQueryClient()
  ensureDefaults(client)
  const { data } = useQuery({
    queryKey: approvalKeys.chat(chatId),
    queryFn: () =>
      client.getQueryData<ChatApprovals>(approvalKeys.chat(chatId)) ??
      NO_CHAT_APPROVALS,
    initialData: NO_CHAT_APPROVALS,
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: Boolean(chatId),
    select: (approvals) => approvals[runId] ?? NO_APPROVALS
  })
  return data ?? NO_APPROVALS
}

/** Allow once / Deny. The card shows the outcome the server recorded (the
 *  first answer stands, from whichever client); a 404 means nothing waits
 *  any more — shown in place, not toasted. */
export function useDecideApproval(chatId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      runId: string
      toolCallId: string
      decision: ApprovalDecision
    }) => decideApproval(vars),
    meta: {
      errorTitle: i18n.t('chat:approval.decideFailed'),
      inlineCodes: [ErrorCode.APPROVAL_NOT_FOUND]
    } satisfies MutationMeta,
    onSuccess: ({ outcome }, { runId, toolCallId }) =>
      settle(client, chatId, runId, toolCallId, outcome),
    onError: (error, { runId, toolCallId }) => {
      if (
        error instanceof HttpError &&
        error.code === ErrorCode.APPROVAL_NOT_FOUND
      ) {
        settle(client, chatId, runId, toolCallId, 'expired')
      }
    }
  })
}
