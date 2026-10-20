// src/main/lib/agents/quota.ts — what each CLI last said of the owner's quota
// (spec 2026-10-16 §3). Kept per CLI, in memory and in ~/.actovia/agent-quota.json:
// Claude Code only reports during a run, so a restart must not forget it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'

import {
  CLI_NAMES,
  type CliId,
  type CliQuota,
  type QuotaWindow
} from '@actovia/shared/types/agents'

import { logger } from '../logger'
import { getActoviaHome } from '../paths'

const fileOf = () => join(getActoviaHome(), 'agent-quota.json')
let store: Map<CliId, CliQuota> | null = null

export { toMs } from './epoch'

const wellFormed = (w: unknown): w is QuotaWindow =>
  typeof w === 'object' &&
  w !== null &&
  typeof (w as QuotaWindow).name === 'string' &&
  Number.isFinite((w as QuotaWindow).usedPercent)

function load(): Map<CliId, CliQuota> {
  if (store) return store
  store = new Map()
  try {
    if (existsSync(fileOf())) {
      const rows = JSON.parse(readFileSync(fileOf(), 'utf8')) as unknown
      if (Array.isArray(rows))
        for (const q of rows as CliQuota[])
          if (q && typeof q.cli === 'string' && Array.isArray(q.windows))
            store.set(q.cli, { ...q, windows: q.windows.filter(wellFormed) })
    }
  } catch (error) {
    logger.warn('agents', 'agent-quota.json unreadable; starting empty', {
      error
    })
  }
  return store
}

// Synchronous: a few hundred bytes, written when a CLI reports, and a write
// still in flight must never land after forgetAllQuotas() removed the file.
function save() {
  try {
    mkdirSync(getActoviaHome(), { recursive: true })
    writeFileSync(fileOf(), JSON.stringify([...load().values()], null, 2))
  } catch (error) {
    logger.warn('agents', 'agent-quota.json not written', { error })
  }
}

/**
 * `merge`: a sparse update (Codex's `updated`) keeps the windows it does not
 * name, and the stored verdict (state, overage, rejected window, asOf) unless
 * it reports a reached limit itself. A full reading replaces the record, but
 * keeps a model's own window it does not mention while that window has not
 * reset: Claude Code reports only the running model's windows, so a sonnet
 * reading must not erase opus's rejection.
 */
export function recordQuota(
  q: CliQuota,
  opts: { merge?: boolean } = {},
  now: number = Date.now()
) {
  const prev = load().get(q.cli)
  let next = q
  if (prev && opts.merge) {
    const byName = new Map(prev.windows.map((w) => [w.name, w]))
    for (const w of q.windows) byName.set(w.name, w)
    const windows = [...byName.values()]
    next =
      q.state === 'rejected'
        ? { ...q, windows }
        : {
            ...q,
            windows,
            state: prev.state,
            overage: prev.overage,
            rejectedWindow: prev.rejectedWindow,
            asOf: prev.asOf
          }
  } else if (prev) {
    const named = new Set(q.windows.map((w) => w.name))
    // A carried window with no reset time keeps the origin it was first seen
    // at (`seenAt`), so carrying it never renews its hour.
    const kept = prev.windows
      .filter(
        (w) =>
          w.model &&
          !named.has(w.name) &&
          (w.resetsAt === null
            ? now - (w.seenAt ?? prev.asOf) < NO_DETAIL_BLOCK_MS
            : w.resetsAt > now)
      )
      .map((w) =>
        w.resetsAt === null ? { ...w, seenAt: w.seenAt ?? prev.asOf } : w
      )
    if (kept.length) next = { ...q, windows: [...q.windows, ...kept] }
  }
  load().set(q.cli, next)
  save()
}

export const getQuota = (cli: CliId): CliQuota | null => load().get(cli) ?? null
export const listQuotas = (): CliQuota[] => [...load().values()]

export async function forgetAllQuotas() {
  load().clear()
  await rm(fileOf(), { force: true })
}

export function resetQuotaStoreForTests() {
  store = null
}

/** A rejection that names no window, or no reset time, blocks this long after it was reported. */
const NO_DETAIL_BLOCK_MS = 60 * 60_000

/** A window with no reset time is only believed for an hour after it was seen. */
export const noResetStale = (w: QuotaWindow, asOf: number, now: number) =>
  w.resetsAt === null && now - (w.seenAt ?? asOf) >= NO_DETAIL_BLOCK_MS

const modelMatches = (windowModel: string, model: string | null | undefined) =>
  !!model && model.toLowerCase().includes(windowModel.toLowerCase())

/**
 * The window that stops `model` from running now, or null. Only the CLI's own
 * rejection without overage blocks — a stale or high reading never does: a
 * window it marked `rejected` (which may outlive the record's state, carried
 * from an earlier reading), else the record's `rejected` state.
 */
export function blockedUntil(
  q: CliQuota | null,
  model: string | null | undefined,
  now: number = Date.now()
): QuotaWindow | null {
  if (!q || q.overage) return null
  const live = (w: QuotaWindow) =>
    w.resetsAt === null ? !noResetStale(w, q.asOf, now) : w.resetsAt > now
  const applies = (w: QuotaWindow) =>
    live(w) && (!w.model || modelMatches(w.model, model))
  const latest = (ws: QuotaWindow[]) =>
    ws.reduce((a, b) => ((b.resetsAt ?? 0) > (a.resetsAt ?? 0) ? b : a))
  const flagged = q.windows.filter((w) => w.rejected && applies(w))
  if (flagged.length > 0) return latest(flagged)
  if (q.state !== 'rejected') return null
  const named = q.windows.find((w) => w.name === q.rejectedWindow)
  if (named) return applies(named) ? named : null
  const full = q.windows.filter((w) => w.usedPercent >= 100 && applies(w))
  if (full.length > 0) return latest(full)
  // Rejected with no window detail: block, reset unknown, while it is fresh.
  return q.windows.length === 0 && now - q.asOf < NO_DETAIL_BLOCK_MS
    ? { name: 'limit', usedPercent: 100, resetsAt: null }
    : null
}

const LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'week'
}
const DURATIONS: Record<number, string> = { 300: '5-hour', 10080: 'week' }

/**
 * A window as the owner says it: `5-hour`, `week`, `opus only: week`
 * (English: the model reads it). Codex names its windows `primary` /
 * `secondary`; its length says which one it is.
 */
export function quotaWindowLabel(w: QuotaWindow): string {
  const suffix = w.model ? `_${w.model.toLowerCase()}` : ''
  const base =
    suffix && w.name.toLowerCase().endsWith(suffix)
      ? w.name.slice(0, -suffix.length)
      : w.name
  const label =
    (w.durationMins !== undefined && DURATIONS[w.durationMins]) ||
    LABELS[base] ||
    w.name
  return `${w.model ? `${w.model} only: ` : ''}${label}`
}

/** The CLI said this window stopped it (and it has not reset by `now`'s reckoning). */
export const windowLimited = (q: CliQuota, w: QuotaWindow): boolean =>
  !!w.rejected ||
  (q.state === 'rejected' &&
    (w.name === q.rejectedWindow || w.usedPercent >= 100))

/** A window whose reset time has passed: what it last said no longer holds. */
export const windowReset = (w: QuotaWindow, now: number): boolean =>
  w.resetsAt !== null && w.resetsAt <= now

function ago(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

const when = (ms: number) =>
  new Date(ms).toLocaleString('en-US', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

/** One line for the PM's roster (English: the model reads it, not the owner). */
export function formatQuotaForPm(
  q: CliQuota | null,
  cli: CliId,
  now: number
): string {
  const name = CLI_NAMES[cli]
  if (!q) return `${name} quota: unknown (it has not reported any).`
  const parts = q.windows.map((w) => {
    const label = quotaWindowLabel(w)
    if (w.resetsAt !== null && windowReset(w, now))
      return `${label}: reset at ${when(w.resetsAt)} (not re-read since)`
    const limited = windowLimited(q, w) && !noResetStale(w, q.asOf, now)
    const flag = limited
      ? ` (LIMIT REACHED${w.resetsAt ? `, resets ${when(w.resetsAt)}` : ''})`
      : q.state === 'warning' && w.usedPercent >= 75
        ? ' (warning)'
        : ''
    const reset = !limited && w.resetsAt ? `, resets ${when(w.resetsAt)}` : ''
    return `${label} ${Math.round(w.usedPercent)} %${flag}${reset}`
  })
  if (!parts.length && q.state === 'rejected') parts.push('LIMIT REACHED')
  parts.push(q.overage ? 'overage allowed' : 'no overage')
  return `${name} quota (as of ${ago(now - q.asOf)}): ${parts.join(' · ')}`
}
