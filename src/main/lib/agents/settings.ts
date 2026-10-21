// src/main/lib/agents/settings.ts
import { homedir } from 'os'
import { join } from 'path'

import { SETTING_DEFAULTS } from '@actovia/shared/constants/setting-defaults'

import { getSettings } from '../db/queries'

/** `settings.agents` with the spec's defaults applied (spec §3). */
export async function agentSettings() {
  const a = (await getSettings()).agents
  return {
    projectsDir: a?.projectsDir || join(homedir(), 'Actovia Projects'),
    maxRunning: a?.maxRunning ?? SETTING_DEFAULTS.agents.maxRunning,
    keepAliveMinutes:
      a?.keepAliveMinutes ?? SETTING_DEFAULTS.agents.keepAliveMinutes,
    worktrees: a?.worktrees ?? true,
    cliPaths: a?.cliPaths ?? {}
  }
}
