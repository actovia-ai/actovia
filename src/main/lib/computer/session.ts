import { SETTING_DEFAULTS } from '@actovia/shared/constants/setting-defaults'
// Computer Runtime — the perceive→act session loop.
//
// The integration hub: wires the Runtime (target resolution, capture, guard,
// hands) and a swappable inner `ComputerAgent` into one bounded loop, wrapped in
// a trace. Spec §1 (the loop diagram), §3.5 (loop controls, askHuman, stuck),
// §3.6 (trace).
//
// Nothing the loop awaits — the agent's `nextAction`, or the helper-backed
// `resolveTarget` / `refreshBounds` / `screenshotWindow` / `hands.execute` —
// takes an abort signal or a timeout of its own, so every one goes through
// `race()`, which bounds it against the run's `AbortSignal` and a deadline.
// `maxSteps` is the final backstop.

import type { ComputerAgent } from '../ai/computer-use/agent'
import { logger } from '../logger'
import { bindTraceAttributes, withTrace } from '../logger/trace-context'
import { computerAskRegistry } from './ask-registry'
import { hashPng, screenshotWindow } from './capture'
import { bringToFront } from './front'
import { AbortedByUser, ForbiddenChord, Guard, OutOfBounds } from './guard'
import * as hands from './hands'
import { getHelper } from './helper'
import { isSelfTarget, SELF_TARGET_MESSAGE } from './self'
import { refreshOrRaise, resolveOrLaunch } from './target'
import type {
  Action,
  ComputerState,
  InputHelper,
  SessionOutcome,
  SessionResult,
  TargetWindow
} from './types'

/** Loop-control defaults (spec §3.5). All overridable per call / by settings. */
const DEFAULT_MAX_STEPS = SETTING_DEFAULTS.computerUse.maxSteps
const DEFAULT_SETTLE_MS = SETTING_DEFAULTS.computerUse.settleMs
const DEFAULT_ASK_HUMAN_TIMEOUT_MS = 300_000
const DEFAULT_STEP_TIMEOUT_MS = 120_000
const DEFAULT_OP_TIMEOUT_MS = 30_000

/** The synthetic question injected on the first frozen ("stuck") frame. */
const STUCK_QUESTION =
  "I don't seem to be making progress — the screen hasn't changed. What " +
  'should I do, or should I stop?'

/**
 * Streamed by the session as it runs. The outer tool relays these over the chat
 * SSE (`onUpdate`) so the panel can show the current step, the last action, an
 * optional thumbnail, an inline askHuman prompt, and the final outcome.
 */
export interface SessionUpdate {
  step: number
  action?: Action['kind']
  thumbnail?: string
  awaitingHuman?: { question: string }
  outcome?: SessionOutcome
}

export interface RunComputerSessionOptions {
  sessionId: string
  task: string
  /** App name / bundle-id query resolved to the target window (spec §2.2). */
  target: string
  /**
   * If set and non-empty, the *resolved* window's `app` / `bundleId` must
   * exactly (case-insensitively) match an entry or the session fails — the
   * outer tool only gates the query string, and `resolveTarget` matches on
   * substring (spec §2.2 / final-review I4).
   */
  allowlist?: string[]
  agent: ComputerAgent
  helper?: InputHelper
  guard?: Guard
  maxSteps?: number
  settleMs?: number
  askHumanTimeoutMs?: number
  /** Deadline for one `agent.nextAction` call. */
  stepTimeoutMs?: number
  /** Deadline for one helper-backed Runtime op (capture, bounds, execute). */
  opTimeoutMs?: number
  signal?: AbortSignal
  onUpdate?: (u: SessionUpdate) => void
}

/**
 * Bound `op` by an abort signal and a timeout. Rejects with `AbortedByUser` the
 * instant `signal` fires (or immediately if it is already aborted), and with a
 * plain `Error` when `timeoutMs` elapses first. A guard winning the race
 * abandons `op` — there is no way to cancel the underlying work, so callers must
 * tolerate a late settle (its rejection is swallowed here so it cannot surface
 * as an unhandledRejection).
 */
export async function race<T>(
  op: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  label: string
): Promise<T> {
  if (signal?.aborted) throw new AbortedByUser('user')

  op.catch(() => {})

  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
  })
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return
    onAbort = () => reject(new AbortedByUser('user'))
    signal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    return await Promise.race([op, timeout, aborted])
  } finally {
    if (timer) clearTimeout(timer)
    if (signal && onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Run one computer-use episode to a terminal `SessionResult`. Blocking: the
 * caller awaits the whole loop and watches `onUpdate` for progress. The episode
 * shares one traceId (`withTrace`); every `logger.*` call inside carries it.
 */
export async function runComputerSession(
  opts: RunComputerSessionOptions
): Promise<SessionResult> {
  const helper = opts.helper ?? getHelper()
  const guard = opts.guard ?? new Guard()
  const { agent, sessionId } = opts
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
  const settleMs = opts.settleMs ?? DEFAULT_SETTLE_MS
  const askHumanTimeoutMs =
    opts.askHumanTimeoutMs ?? DEFAULT_ASK_HUMAN_TIMEOUT_MS
  const stepTimeoutMs = opts.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
  const opTimeoutMs = opts.opTimeoutMs ?? DEFAULT_OP_TIMEOUT_MS

  // The Guard is the single abort authority — link the run's AbortSignal into
  // it so a chat Stop / client disconnect trips the same flag the global hotkey
  // and `POST /api/v1/computer-use/abort` use. Every `race()` below then watches
  // `guard.signal`, so a session parked in a `wait` sleep or in `askHuman`
  // still unwinds at once.
  if (opts.signal) {
    if (opts.signal.aborted) guard.abort('user')
    else
      opts.signal.addEventListener('abort', () => guard.abort('user'), {
        once: true
      })
  }

  return withTrace(async () => {
    bindTraceAttributes({
      computerSession: sessionId,
      target: opts.target,
      task: opts.task
    })

    let step = 0
    let lastShot: ComputerState['screenshot'] | undefined

    const emit = (u: SessionUpdate): void => {
      try {
        opts.onUpdate?.(u)
      } catch (err) {
        logger.warn('computer', 'onUpdate callback threw', {
          err: errText(err)
        })
      }
    }

    const finish = (
      outcome: SessionOutcome,
      summary: string
    ): SessionResult => {
      logger.info('computer', 'session end', { outcome, steps: step, summary })
      emit({ step, outcome })
      return {
        outcome,
        summary,
        steps: step,
        ...(lastShot ? { finalScreenshot: lastShot } : {})
      }
    }

    // --- resolve the target window -----------------------------------------
    // Launch/raise the app only when `opts.target` is itself an exact allowlist
    // entry — the resolved window is still re-checked against the allowlist
    // below before any action runs.
    const norm = (s: string): string => s.trim().toLowerCase()
    const allowedNames = (opts.allowlist ?? []).map(norm)
    const mayLaunch =
      allowedNames.length > 0 && allowedNames.includes(norm(opts.target))

    let target: TargetWindow
    try {
      target = await race(
        resolveOrLaunch(opts.target, helper, {
          launch: mayLaunch,
          retryDelayMs: settleMs
        }),
        guard.signal,
        opTimeoutMs,
        'resolveTarget'
      )
    } catch (err) {
      if (err instanceof AbortedByUser) return finish('aborted', err.message)
      // TargetNotFound (or a timeout) — nothing to drive.
      return finish('failed', errText(err))
    }

    // Never Actovia's own window, allowlisted or not (see self.ts): a session
    // there could click "Allow once" on its own approval prompt.
    if (isSelfTarget(target)) {
      return finish('failed', SELF_TARGET_MESSAGE)
    }

    // Re-check the RESOLVED window against the allowlist. The outer tool matches
    // the model's `target` string; `resolveTarget` then picks a window by
    // substring, so an allowlisted "Chess" could otherwise resolve a look-alike.
    // Run again on any window the session moves to (`refreshOrRaise`).
    const refusal = (w: TargetWindow): string | null => {
      if (isSelfTarget(w)) return SELF_TARGET_MESSAGE
      if (
        allowedNames.length > 0 &&
        ![w.app, w.bundleId].some((id) => allowedNames.includes(norm(id)))
      ) {
        return `resolved window "${w.app}" (${w.bundleId}) is not on the allowlist`
      }
      return null
    }
    {
      const refused = refusal(target)
      if (refused) return finish('failed', refused)
    }

    bindTraceAttributes({ targetApp: target.app })

    let cursor: [number, number] | undefined
    let lastActionKind: Action['kind'] | undefined
    let nextHumanNote: string | undefined
    let nextSystemNote: string | undefined
    let stuckStreak = 0

    // The askHuman handshake — shared by the model-emitted `askHuman` action and
    // the synthetic stuck prompt. Resolves to the answer, or to a terminal
    // `SessionResult` when the wait is aborted (`aborted`) or times out
    // (`abandoned`). Nothing is executed for the step that asks.
    const awaitHuman = async (
      question: string
    ): Promise<{ answer: string } | SessionResult> => {
      emit({ step, awaitingHuman: { question } })
      try {
        const answer = await race(
          computerAskRegistry.wait(sessionId),
          guard.signal,
          askHumanTimeoutMs,
          'askHuman'
        )
        return { answer }
      } catch (err) {
        if (err instanceof AbortedByUser) return finish('aborted', err.message)
        return finish(
          'abandoned',
          `nobody answered "${question}" within ${askHumanTimeoutMs}ms`
        )
      }
    }

    try {
      for (let s = 1; s <= maxSteps; s++) {
        step = s

        if (guard.aborted) {
          return finish('aborted', 'the session was stopped')
        }

        // --- perceive ----------------------------------------------------
        try {
          const was = target.cgWindowId
          target = await race(
            refreshOrRaise(target, helper, settleMs),
            guard.signal,
            opTimeoutMs,
            'refreshBounds'
          )
          if (target.cgWindowId !== was) {
            const refused = refusal(target)
            if (refused) return finish('failed', refused)
          }
        } catch (err) {
          if (err instanceof AbortedByUser) {
            return finish('aborted', err.message)
          }
          // WindowGone (or a timeout) — the target is unusable.
          return finish('failed', errText(err))
        }

        const { shot, scaleFactor } = await race(
          screenshotWindow(target, helper),
          guard.signal,
          opTimeoutMs,
          'screenshotWindow'
        )
        lastShot = shot
        if (!cursor) {
          cursor = [Math.round(shot.width / 2), Math.round(shot.height / 2)]
        }

        // Stuck detection — skipped entirely after a `wait`: a slow page load is
        // several identical frames during a legitimate wait, not a dead loop.
        if (lastActionKind !== 'wait') {
          if (guard.noteFrame(hashPng(shot.data)) === 'stuck') {
            stuckStreak += 1
            if (stuckStreak >= 2) {
              return finish(
                'stuck',
                'Stopped making progress — the screen has not changed across ' +
                  'several steps.'
              )
            }
            logger.info('computer', 'stuck — asking for guidance', { step })
            const res = await awaitHuman(STUCK_QUESTION)
            if ('outcome' in res) return res
            nextHumanNote = res.answer
            continue
          }
          stuckStreak = 0
        }

        // --- think -----------------------------------------------------
        const state: ComputerState = {
          step,
          target: { app: target.app, title: target.title },
          viewport: { width: target.bounds[2], height: target.bounds[3] },
          cursor,
          screenshot: shot,
          ...(nextHumanNote ? { humanNote: nextHumanNote } : {}),
          ...(nextSystemNote ? { systemNote: nextSystemNote } : {})
        }
        nextHumanNote = undefined
        nextSystemNote = undefined

        let action: Action
        try {
          action = await race(
            agent.nextAction(state),
            guard.signal,
            stepTimeoutMs,
            'nextAction'
          )
        } catch (err) {
          if (err instanceof AbortedByUser)
            return finish('aborted', err.message)
          // A timeout, or an agent that threw — either way this episode is done.
          return finish('failed', errText(err))
        }

        // An abort that landed *during* a slow `nextAction` — before we act on
        // whatever the model returned (a stale `done` included).
        if (guard.aborted) return finish('aborted', 'the session was stopped')

        logger.info('computer', 'step', { step, action: action.kind })

        if (action.kind === 'done') {
          return finish(action.success ? 'success' : 'failed', action.summary)
        }

        if (action.kind === 'askHuman') {
          const res = await awaitHuman(action.question)
          if ('outcome' in res) return res
          nextHumanNote = res.answer
          continue
        }

        if (action.kind === 'wait') {
          // Cap a model-chosen wait (unclamped, sometimes minutes) and race it
          // against the guard so an abort mid-sleep is observed immediately.
          try {
            await race(
              sleep(Math.min(action.ms, 30_000)),
              guard.signal,
              31_000,
              'wait'
            )
          } catch (err) {
            if (err instanceof AbortedByUser)
              return finish('aborted', err.message)
            throw err
          }
          lastActionKind = 'wait'
          emit({ step, action: 'wait', thumbnail: shot.data })
          continue
        }

        // --- act ------------------------------------------------------
        // Clamp/reject in SCREENSHOT-pixel space — the space the model's
        // coordinates are in. `state.viewport` is the window size in points, a
        // different space.
        let clamped: Action
        try {
          clamped = guard.check(action, {
            width: shot.width,
            height: shot.height
          })
        } catch (err) {
          if (err instanceof AbortedByUser)
            return finish('aborted', err.message)
          if (err instanceof OutOfBounds || err instanceof ForbiddenChord) {
            // A model slip, not a session-ender — skip this step, feed a note
            // back so the model knows it was dropped, and let the next fresh
            // screenshot give it a retry.
            logger.warn('computer', 'action rejected — skipped', {
              step,
              action: action.kind,
              reason: err.name
            })
            nextSystemNote =
              err instanceof ForbiddenChord
                ? `That key chord is blocked because it would switch or quit ` +
                  `apps and leave this window. Stay inside the window.`
                : `Your last action's coordinate was off the ${shot.width}×` +
                  `${shot.height} screenshot and was skipped. Keep x within ` +
                  `[0, ${shot.width}] and y within [0, ${shot.height}].`
            continue
          }
          throw err
        }

        // The target in front, or the input is not sent (see front.ts).
        const front = await race(
          bringToFront(target, helper, { settleMs: Math.min(settleMs, 200) }),
          guard.signal,
          opTimeoutMs,
          'bringToFront'
        )
        if (!front.ok) {
          logger.warn('computer', 'target not in front — action skipped', {
            step,
            action: clamped.kind,
            reason: front.reason
          })
          nextSystemNote =
            `Your last action was not sent: ${front.reason}. If a dialog ` +
            `or window you cannot close is in the way, use askHuman to ask ` +
            `the user to close it.`
          lastActionKind = clamped.kind
          continue
        }
        target = front.target

        await race(
          hands.execute(clamped, { target, scaleFactor, helper }),
          guard.signal,
          opTimeoutMs,
          'execute'
        )

        if (
          clamped.kind === 'click' ||
          clamped.kind === 'moveMouse' ||
          clamped.kind === 'drag'
        ) {
          cursor = clamped.to
        }
        lastActionKind = clamped.kind
        await sleep(settleMs)
        emit({ step, action: clamped.kind, thumbnail: shot.data })
      }

      return finish('failed', 'reached the step limit without finishing')
    } catch (err) {
      if (err instanceof AbortedByUser) return finish('aborted', err.message)
      return finish('failed', errText(err))
    }
  })
}
