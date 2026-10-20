import type { ApprovalOutcome } from '@actovia/shared/types/chat'

/**
 * Tool calls paused for the user's approval (see `approval.ts`), keyed by
 * run and tool call. Each settles exactly once — the user's answer, the
 * timeout, or the run's abort — and is removed in every one of those paths.
 * In memory only: a restart ends every run anyway.
 */

/** How long a paused call waits for the user before it is declined. */
export const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000

/** How long a decision is remembered, so a repeated POST gets the same answer. */
const DECIDED_TTL_MS = 10 * 60 * 1000
const DECIDED_MAX = 256

interface Pending {
  settle: (outcome: ApprovalOutcome) => void
}

const pending = new Map<string, Pending>()
const decided = new Map<string, { outcome: ApprovalOutcome; at: number }>()

const keyOf = (runId: string, toolCallId: string) =>
  `${runId}\u0000${toolCallId}`

function remember(key: string, outcome: ApprovalOutcome) {
  const now = Date.now()
  for (const [k, v] of decided) {
    if (now - v.at > DECIDED_TTL_MS || decided.size >= DECIDED_MAX) {
      decided.delete(k)
    } else break
  }
  decided.set(key, { outcome, at: now })
}

/**
 * Pauses until the call is decided. Settles exactly once — `allowed` /
 * `denied` from `decideApproval`, `timed_out` after `timeoutMs`, `stopped`
 * when `signal` aborts — and leaves nothing behind in any of those paths.
 */
export function awaitApproval({
  runId,
  toolCallId,
  signal,
  timeoutMs = APPROVAL_TIMEOUT_MS
}: {
  runId: string
  toolCallId: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<ApprovalOutcome> {
  return new Promise((resolvePromise) => {
    if (signal?.aborted) {
      resolvePromise('stopped')
      return
    }
    const key = keyOf(runId, toolCallId)
    // A second pause under an id still waiting (a model-chosen duplicate id)
    // never replaces the first: the card on screen and the entry it answers
    // must stay the same call. The newcomer settles `stopped` at once — the
    // kernel checks `isApprovalPending` first and blocks it without a card.
    if (pending.has(key)) {
      resolvePromise('stopped')
      return
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = () => entry.settle('stopped')
    const entry: Pending = {
      settle(outcome) {
        if (pending.get(key) !== entry) return
        pending.delete(key)
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolvePromise(outcome)
      }
    }
    pending.set(key, entry)
    timer = setTimeout(() => entry.settle('timed_out'), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * The user's answer. Returns the call's outcome — this decision, or the one
 * already recorded for it (a repeated POST is idempotent: the first decision
 * stands) — or null when nothing is pending or recently decided under that
 * id (unknown, timed out, stopped).
 */
export function decideApproval(
  runId: string,
  toolCallId: string,
  decision: 'allow' | 'deny'
): ApprovalOutcome | null {
  const key = keyOf(runId, toolCallId)
  const entry = pending.get(key)
  if (entry) {
    const outcome: ApprovalOutcome = decision === 'allow' ? 'allowed' : 'denied'
    remember(key, outcome)
    entry.settle(outcome)
    return outcome
  }
  const known = decided.get(key)
  if (!known || Date.now() - known.at > DECIDED_TTL_MS) return null
  return known.outcome
}

/** Whether a call with this id is already waiting for the user. */
export function isApprovalPending(runId: string, toolCallId: string): boolean {
  return pending.has(keyOf(runId, toolCallId))
}

/** Stops every call of a run still waiting — the run's own cleanup. */
export function cancelApprovals(runId: string): void {
  const prefix = `${runId}\u0000`
  for (const [key, entry] of pending) {
    if (key.startsWith(prefix)) entry.settle('stopped')
  }
}

/** How many calls are waiting (tests: nothing leaks). */
export function pendingApprovalCount(): number {
  return pending.size
}

/** Tests only: forget every recorded decision. */
export function resetApprovalsForTests(): void {
  for (const entry of pending.values()) entry.settle('stopped')
  decided.clear()
}
