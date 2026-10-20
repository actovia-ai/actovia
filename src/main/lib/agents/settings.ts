// src/main/lib/agents/settings.ts
import { homedir } from 'os'
import { join } from 'path'

import { getSettings } from '../db/queries'

/** `settings.agents` with the spec's defaults applied (spec §3). */
export async function agentSettings() {
  const a = (await getSettings()).agents
  return {
    projectsDir: a?.projectsDir || join(homedir(), 'Actovia Projects'),
    maxRunning: a?.maxRunning ?? 2,
    keepAliveMinutes: a?.keepAliveMinutes ?? 10,
    worktrees: a?.worktrees ?? true,
    cliPaths: a?.cliPaths ?? {}
  }
}
