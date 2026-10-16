// src/main/lib/agents/quota.ts — what each CLI last said of the owner's quota
// (spec 2026-10-16 §3). Kept per CLI, in memory and in ~/.exodus/agent-quota.json:
// Claude Code only reports during a run, so a restart must not forget it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'

import {
  CLI_NAMES,
  type CliId,
  type CliQuota,
  type QuotaWindow
} from '@exodus/shared/types/agents'

import { logger } from '../logger'
import { getExodusHome } from '../paths'

const fileOf = () => join(getExodusHome(), 'agent-quota.json')
let store: Map<CliId, CliQuota> | null = null

export { toMs } from './epoch'

function load(): Map<CliId, CliQuota> {
  if (store) return store
  store = new Map()
  try {
    if (existsSync(fileOf())) {
      const rows = JSON.parse(readFileSync(fileOf(), 'utf8')) as unknown
      if (Array.isArray(rows))
        for (const q of rows as CliQuota[])
          if (q && typeof q.cli === 'string' && Array.isArray(q.windows))
            store.set(q.cli, q)
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
    mkdirSync(getExodusHome(), { recursive: true })
    writeFileSync(fileOf(), JSON.stringify([...load().values()], null, 2))
  } catch (error) {
    logger.warn('agents', 'agent-quota.json not written', { error })
  }
}

/** `merge`: a sparse update (Codex's `updated`) keeps windows it does not name. */
export function recordQuota(q: CliQuota, opts: { merge?: boolean } = {}) {
  const prev = load().get(q.cli)
  let next = q
  if (opts.merge && prev) {
    const byName = new Map(prev.windows.map((w) => [w.name, w]))
    for (const w of q.windows) byName.set(w.name, w)
    next = { ...q, windows: [...byName.values()] }
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

const modelMatches = (windowModel: string, model: string | null | undefined) =>
  !!model && model.toLowerCase().includes(windowModel.toLowerCase())

/**
 * The window that stops `model` from running now, or null. Only the CLI's own
 * `rejected` without overage blocks — a stale or high reading never does.
 */
export function blockedUntil(
  q: CliQuota | null,
  model: string | null | undefined
): QuotaWindow | null {
  if (!q || q.state !== 'rejected' || q.overage) return null
  const applies = (w: QuotaWindow) => !w.model || modelMatches(w.model, model)
  const named = q.windows.find((w) => w.name === q.rejectedWindow)
  if (named) return applies(named) ? named : null
  const full = q.windows.filter((w) => w.usedPercent >= 100 && applies(w))
  if (full.length)
    return full.reduce((a, b) =>
      (b.resetsAt ?? 0) > (a.resetsAt ?? 0) ? b : a
    )
  // Rejected with no window detail: block, reset unknown.
  return q.windows.length
    ? null
    : { name: 'limit', usedPercent: 100, resetsAt: null }
}

const LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'week'
}

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
    const label = `${w.model ? `${w.model} only: ` : ''}${LABELS[w.name] ?? w.name}`
    const limited =
      q.state === 'rejected' &&
      (w.name === q.rejectedWindow || w.usedPercent >= 100)
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
