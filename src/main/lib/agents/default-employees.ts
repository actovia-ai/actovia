import {
  DEFAULT_AVATAR_STYLE,
  randomAvatarSeed
} from '@exodus/shared/constants/avatar'
import { CLI_IDS, CLI_NAMES } from '@exodus/shared/types/agents'

import { createAgent, getAllAgents } from '../db/philharmonic-queries'
import { getCliStatus } from './cli-check'

/** Once a CLI is Ready and no employee runs on it yet, add one ("Claude Code", the CLI's default model, `default` mode). */
export async function ensureDefaultCliEmployees(): Promise<void> {
  const agents = await getAllAgents()
  for (const id of CLI_IDS) {
    if (agents.some((a) => a.runtime === id)) continue
    if ((await getCliStatus(id)).state !== 'ready') continue
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
}
