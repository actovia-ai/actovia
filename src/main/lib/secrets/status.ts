import { encryptionState, type EncryptionState } from './crypto'

/**
 * What the Settings notice needs (`GET /api/v1/settings/secrets-status`):
 * whether secrets are encrypted at rest, and which stored secrets need
 * entering again — those that did not decrypt (each reads as unset), and
 * those a destination move cleared (`moved.ts`).
 *
 * Names are the registry path for a settings field
 * (`providers.openaiApiKey`) and `mcp:<server>:<column>.<name>` for an MCP
 * secret (`mcp:github:env.GITHUB_TOKEN`). Refreshed whenever the settings
 * row or an MCP row is decrypted, so a re-entered key drops off by itself.
 */

let settingsFailures: string[] = []
const mcpFailures = new Map<string, string[]>()

export function recordSettingsDecryptFailures(paths: string[]): void {
  settingsFailures = [...paths]
}

export function recordMcpDecryptFailures(
  serverId: string,
  labels: string[]
): void {
  if (labels.length > 0) mcpFailures.set(serverId, [...labels])
  else mcpFailures.delete(serverId)
}

export function forgetMcpServer(serverId: string): void {
  mcpFailures.delete(serverId)
}

/** Before a read of every MCP row: rows gone since are not reported. */
export function clearMcpDecryptFailures(): void {
  mcpFailures.clear()
}

export interface SecretsStatus {
  encryption: EncryptionState
  needsReentry: string[]
}

/**
 * `moved`: what a destination move cleared (`moved.ts`) — listed with the
 * decrypt failures, one name each. The list stays plain names (the desktop
 * notice and actovia-ios read it as such); the notice's copy covers both.
 */
export function getSecretsStatus(moved: string[] = []): SecretsStatus {
  return {
    encryption: encryptionState(),
    needsReentry: [
      ...new Set([
        ...settingsFailures,
        ...[...mcpFailures.values()].flat(),
        ...moved
      ])
    ]
  }
}
