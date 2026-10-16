// Read the quotas that can be read without spending any before the PM deals
// (spec 2026-10-16 §3): Codex answers any time; Claude Code only reports in a run.
import type { CliId, CliQuota, CliStatus } from '@exodus/shared/types/agents'

import { logger } from '../logger'
import { getCliStatus, readCodexQuota } from './cli-check'
import { loginShellEnv } from './login-shell'
import { getQuota, recordQuota } from './quota'

const FRESH_MS = 60_000

export interface RefreshDeps {
  status(cli: CliId): Promise<CliStatus>
  env(): Promise<Record<string, string>>
  read(path: string, env: Record<string, string>): Promise<CliQuota | null>
  now(): number
}

const defaultDeps: RefreshDeps = {
  status: (cli) => getCliStatus(cli),
  env: loginShellEnv,
  read: (path, env) => readCodexQuota(path, env),
  now: () => Date.now()
}

/** Never throws: a CLI that cannot say keeps what it said last. */
export async function refreshQuotas(
  clis: CliId[],
  deps: RefreshDeps = defaultDeps
) {
  if (!clis.includes('codex')) return
  const last = getQuota('codex')
  if (last && deps.now() - last.asOf < FRESH_MS) return
  try {
    const status = await deps.status('codex')
    if (status.state !== 'ready' || !status.path) return
    const quota = await deps.read(status.path, await deps.env())
    if (quota) recordQuota(quota)
  } catch (error) {
    logger.warn('agents', 'Codex quota read failed', { error })
  }
}
