import {
  DEFAULT_AVATAR_STYLE,
  randomAvatarSeed
} from '@exodus/shared/constants/avatar'
import { CLI_IDS, CLI_NAMES } from '@exodus/shared/types/agents'

import { createAgent, getAllAgents } from '../db/philharmonic-queries'
import { getSettings, updateSettingField } from '../db/queries'
import { getCliStatus } from './cli-check'

let running: Promise<void> | null = null

/**
 * After a check finds a CLI Ready: add its employee ("Claude Code", "Codex";
 * the CLI's default model, `default` mode) — once per CLI. Settings record it, so an employee
 * the owner deleted is never added back. One run at a time: two checks
 * landing together share it.
 */
export function ensureDefaultCliEmployees(): Promise<void> {
  running ??= addOnce().finally(() => {
    running = null
  })
  return running
}

async function addOnce(): Promise<void> {
  const stored = (await getSettings()).agents
  const created: Record<string, boolean> = {
    ...stored?.defaultEmployeesCreated
  }
  const agents = await getAllAgents()
  let changed = false
  for (const id of CLI_IDS) {
    if (created[id]) continue
    if ((await getCliStatus(id)).state !== 'ready') continue
    created[id] = true
    changed = true
    // One the owner made already counts: the default is never added beside it.
    if (agents.some((a) => a.runtime === id)) continue
    await createAgent({
      name: CLI_NAMES[id],
      description: 'Writes and changes code in the group’s folder.',
      runtime: id,
      model: null,
      provider: null,
      permissionMode: null,
      avatarSeed: randomAvatarSeed(),
      avatarStyle: DEFAULT_AVATAR_STYLE
    })
  }
  if (!changed) return
  await updateSettingField('agents', {
    ...stored,
    defaultEmployeesCreated: created
  })
}
