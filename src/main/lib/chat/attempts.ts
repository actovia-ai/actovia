// Regenerate as a side-by-side comparison (spec
// docs/superpowers/specs/2026-09-26-regenerate-compare-design.md §2): every
// transition of a regenerate group's `attempt` state lives here, and nothing
// else writes `message.attempt` / `message.alternateOf`.
//
// A group is its first run G plus every run whose user row has
// `alternateOf = G`. The state sits on each run's user row (id === runId):
// `comparing` (one of the two answers side by side), `chosen`, `folded` (the
// other one, behind "1 other version"), `hidden` (older than the newest two).
// Each transition reads the chat's user rows and writes inside one
// transaction, so two quick clicks apply one after the other, never
// interleaved — and every transition is idempotent.
import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { ConflictError, NotFoundError } from '@actovia/shared/errors/app-error'
import type { Attempt } from '@actovia/shared/types/chat'
import { and, asc, eq, inArray } from 'drizzle-orm'

import { db } from '../db/db'
import { message } from '../db/schema'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** A run as its user row describes it. */
interface RunHead {
  runId: string
  createdAt: Date
  alternateOf: string | null
  attempt: Attempt | null
}

/** Not shown and never context: an older attempt, or the one not chosen. */
const OUT_OF_VIEW: ReadonlySet<Attempt> = new Set(['folded', 'hidden'])

/** A run's answer counts as failed when its last assistant row ended so. */
const FAILED_STOP_REASONS = ['error', 'aborted']

/** Every run of the chat, oldest first. */
async function runHeads(tx: Tx, chatId: string): Promise<RunHead[]> {
  const rows = await tx
    .select({
      id: message.id,
      runId: message.runId,
      createdAt: message.createdAt,
      alternateOf: message.alternateOf,
      attempt: message.attempt
    })
    .from(message)
    .where(and(eq(message.chatId, chatId), eq(message.role, 'user')))
    .orderBy(asc(message.createdAt))
  return rows
    .filter((r) => r.id === r.runId)
    .map((r) => ({
      runId: r.runId,
      createdAt: r.createdAt,
      alternateOf: r.alternateOf,
      attempt: r.attempt
    }))
}

/** The id of the group a run belongs to (its own id for an ordinary run). */
function groupIdOf(run: RunHead): string {
  return run.alternateOf ?? run.runId
}

/** A group's runs, oldest first. */
function membersOf(runs: RunHead[], groupId: string): RunHead[] {
  return runs.filter((r) => groupIdOf(r) === groupId)
}

function byNewest(a: RunHead, b: RunHead): number {
  return b.createdAt.getTime() - a.createdAt.getTime()
}

async function setAttempt(
  tx: Tx,
  chatId: string,
  runId: string,
  attempt: Attempt,
  alternateOf?: string
): Promise<void> {
  await tx
    .update(message)
    .set(alternateOf === undefined ? { attempt } : { attempt, alternateOf })
    .where(
      and(
        eq(message.chatId, chatId),
        eq(message.id, runId),
        eq(message.runId, runId)
      )
    )
}

function attemptsMap(members: RunHead[]): Record<string, Attempt> {
  const out: Record<string, Attempt> = {}
  for (const m of members) if (m.attempt) out[m.runId] = m.attempt
  return out
}

function runNotFound(): NotFoundError {
  return new NotFoundError(
    ErrorCode.RUN_NOT_FOUND,
    'No run with that id in this chat.'
  )
}

/**
 * The first run of the group `runId` belongs to — what a Regenerate's
 * `alternateOf` must name. `404 RUN_NOT_FOUND` when `runId` is not a run of
 * this chat. The chat route asks before it saves the new user row, so a bad
 * id leaves nothing behind.
 */
export function resolveRegenerateGroup(
  chatId: string,
  runId: string
): Promise<string> {
  return db.transaction(async (tx) => {
    const target = (await runHeads(tx, chatId)).find((r) => r.runId === runId)
    if (!target) throw runNotFound()
    return groupIdOf(target)
  })
}

/**
 * A Regenerate arrived: `newRunId` (its user row already saved) re-asks
 * group `groupId`. The new run and the newest other visible run of the group
 * are `comparing`; every other run of the group is `hidden`. The group's
 * first run gets its `attempt` here on the first regenerate (it was null).
 * `groupId` may name any run of the group — it is resolved to the first.
 */
export async function recordRegenerate(
  chatId: string,
  newRunId: string,
  groupId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const runs = await runHeads(tx, chatId)
    const target = runs.find((r) => r.runId === groupId)
    const fresh = runs.find((r) => r.runId === newRunId)
    if (!target || !fresh) throw runNotFound()
    const group = groupIdOf(target)
    const others = membersOf(runs, group)
      .filter((r) => r.runId !== newRunId)
      .toSorted(byNewest)
    if (others.length === 0) throw runNotFound()
    const partner =
      others.find((r) => !r.attempt || !OUT_OF_VIEW.has(r.attempt)) ?? others[0]

    await setAttempt(tx, chatId, newRunId, 'comparing', group)
    for (const run of others) {
      const next: Attempt = run === partner ? 'comparing' : 'hidden'
      if (run.attempt !== next) await setAttempt(tx, chatId, run.runId, next)
    }
  })
}

/**
 * The user picked `runId` ("Use this one" / "Use this instead"): it becomes
 * `chosen` and the group's other visible run `folded`. Refused with
 * `409 ATTEMPT_LOCKED` once a run later than the group exists — unless
 * `runId` is already the chosen one, which, like every repeat, is a no-op.
 * `404 RUN_NOT_FOUND` for a run that is not in this chat or not in a
 * regenerate group; a `hidden` run cannot be chosen (409).
 */
export function chooseAttempt(
  chatId: string,
  runId: string
): Promise<{ attempts: Record<string, Attempt> }> {
  return db.transaction(async (tx) => {
    const runs = await runHeads(tx, chatId)
    const target = runs.find((r) => r.runId === runId)
    if (!target) throw runNotFound()
    const members = membersOf(runs, groupIdOf(target))
    if (members.length < 2 || !target.attempt) throw runNotFound()

    if (target.attempt === 'chosen') return { attempts: attemptsMap(members) }

    const groupEnd = Math.max(...members.map((m) => m.createdAt.getTime()))
    const memberIds = new Set(members.map((m) => m.runId))
    const later = runs.some(
      (r) => !memberIds.has(r.runId) && r.createdAt.getTime() > groupEnd
    )
    if (later || target.attempt === 'hidden') {
      throw new ConflictError(
        ErrorCode.ATTEMPT_LOCKED,
        'This answer can no longer be chosen.'
      )
    }

    await setAttempt(tx, chatId, runId, 'chosen')
    target.attempt = 'chosen'
    for (const run of members) {
      if (run === target) continue
      if (run.attempt === 'comparing' || run.attempt === 'chosen') {
        await setAttempt(tx, chatId, run.runId, 'folded')
        run.attempt = 'folded'
      }
    }
    return { attempts: attemptsMap(members) }
  })
}

/**
 * An ordinary run arrived while a comparison is open: the newer answer that
 * did not fail or stop becomes `chosen` (`pickAutoChoice`), the other
 * `comparing` run `folded`. Call it before the new run's context is
 * assembled, so the model never sees both. A no-op when nothing is open.
 */
export async function settleOpenComparison(chatId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const runs = await runHeads(tx, chatId)
    const open = runs.filter((r) => r.attempt === 'comparing')
    if (open.length === 0) return

    const failed = await failedRuns(
      tx,
      chatId,
      open.map((r) => r.runId)
    )
    const groups = new Map<string, RunHead[]>()
    for (const run of open) {
      const g = groupIdOf(run)
      groups.set(g, [...(groups.get(g) ?? []), run])
    }
    for (const comparing of groups.values()) {
      const pick = pickAutoChoice(
        comparing.map((r) => ({
          runId: r.runId,
          createdAt: r.createdAt,
          failed: failed.has(r.runId)
        }))
      )
      for (const run of comparing) {
        await setAttempt(
          tx,
          chatId,
          run.runId,
          run.runId === pick ? 'chosen' : 'folded'
        )
      }
    }
  })
}

/**
 * The runs among `runIds` whose answer failed: the last assistant row
 * stopped on `error` / `aborted`, or there is no assistant row at all.
 */
async function failedRuns(
  tx: Tx,
  chatId: string,
  runIds: string[]
): Promise<Set<string>> {
  const rows = await tx
    .select({ runId: message.runId, stopReason: message.stopReason })
    .from(message)
    .where(
      and(
        eq(message.chatId, chatId),
        eq(message.role, 'assistant'),
        inArray(message.runId, runIds)
      )
    )
    .orderBy(asc(message.createdAt))
  const last = new Map<string, string | null>()
  for (const r of rows) last.set(r.runId, r.stopReason)
  return new Set(
    runIds.filter((id) => {
      if (!last.has(id)) return true
      return FAILED_STOP_REASONS.includes(last.get(id) ?? '')
    })
  )
}

/**
 * Which open attempt wins when the user moves on without choosing: the
 * newest one whose answer did not fail or stop; when every one did, the
 * oldest (ledger ruling 2026-09-26 — a failed answer never wins by default).
 */
export function pickAutoChoice(
  runs: Array<{ runId: string; createdAt: Date; failed: boolean }>
): string {
  if (runs.length === 0) throw new Error('pickAutoChoice: no runs')
  const newestFirst = runs.toSorted(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  )
  return (newestFirst.find((r) => !r.failed) ?? newestFirst.at(-1)!).runId
}

/** Every run of the chat that has an attempt state, by run id. */
export function getChatAttempts(
  chatId: string
): Promise<Record<string, Attempt>> {
  return db.transaction(async (tx) => attemptsMap(await runHeads(tx, chatId)))
}

// `messages` with each user message's `attempt` replaced by the stored one:
// the same function a client applies the server's answer with.
export { applyAttempts } from '@actovia/shared/utils/attempts'
