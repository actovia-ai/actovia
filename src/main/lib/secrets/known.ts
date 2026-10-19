import { getAllMcpServers } from '../db/mcp-queries'
import { getSettings } from '../db/queries'
import { mcpServerSecretValues, settingsSecretValues } from './values'

/**
 * Every secret value Actovia holds right now, in plaintext: the settings
 * registry fields and each MCP server's `env` / `headers` values,
 * `extraConfig` secrets and the secrets inside its `url` / `args`. For scrubbing copies of old text (`scrub.ts`); never
 * leaves the process.
 */
export async function knownSecretValues(): Promise<string[]> {
  const out = settingsSecretValues(await getSettings())
  for (const server of await getAllMcpServers()) {
    out.push(...mcpServerSecretValues(server))
  }
  return out
}
