import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'

import { getSecretsReentryPath } from '../paths'
import { mcpSecretLabels } from './at-rest'
import { getAtPath } from './tree'

/**
 * Secrets a write cleared because their destination moved (ruling R1: a
 * stored key never follows a new host — a provider base URL, the LightRAG
 * URL, an MCP server's url / transport or command / args). Each is
 * listed in `GET /api/v1/settings/secrets-status` `needsReentry` beside the
 * decrypt failures, until a new value is saved for it (S3 review I2).
 *
 * Persisted in `~/.actovia/secrets-reentry.json` so the prompt survives a
 * restart and reaches actovia-ios. Names only: a settings path
 * (`providers.openaiApiKey`), or an MCP server id with `<column>.<name>`
 * labels (`headers.Authorization`) — rendered with the server's current name
 * when read. Reads prune whatever has a value again, or is gone.
 */

interface MovedStore {
  settings: string[]
  mcp: Record<string, string[]>
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

function readStore(): MovedStore {
  const empty: MovedStore = { settings: [], mcp: {} }
  const path = getSecretsReentryPath()
  if (!existsSync(path)) return empty
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<MovedStore>
    const mcp: Record<string, string[]> = {}
    for (const [id, labels] of Object.entries(parsed.mcp ?? {})) {
      if (isStringArray(labels) && labels.length > 0) mcp[id] = labels
    }
    return {
      settings: isStringArray(parsed.settings) ? parsed.settings : [],
      mcp
    }
  } catch {
    return empty
  }
}

function writeStore(store: MovedStore): void {
  const path = getSecretsReentryPath()
  try {
    if (store.settings.length === 0 && Object.keys(store.mcp).length === 0) {
      rmSync(path, { force: true })
      return
    }
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(store, null, 2))
    renameSync(tmp, path)
  } catch (error) {
    // The prompt is a convenience: a failed write must never fail the save.
    void import('../logger').then(({ logger }) =>
      logger.warn('secrets', 'Could not record the secrets to re-enter', {
        code: (error as { code?: string } | null)?.code
      })
    )
  }
}

const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

/**
 * After a settings write: `moved` — the paths it cleared for a new
 * destination; `filled` — the paths it now holds a value for.
 */
export function recordSettingsWrite({
  moved,
  filled
}: {
  moved: string[]
  filled: string[]
}): void {
  if (moved.length === 0 && filled.length === 0) return
  const store = readStore()
  const next = [
    ...new Set([...store.settings.filter((p) => !filled.includes(p)), ...moved])
  ]
  if (same(next, store.settings)) return
  writeStore({ ...store, settings: next })
}

/** The same after an MCP server update (labels as `<column>.<name>`). */
export function recordMcpWrite(
  serverId: string,
  { moved, filled }: { moved: string[]; filled: string[] }
): void {
  const store = readStore()
  const before = store.mcp[serverId] ?? []
  const next = [
    ...new Set([...before.filter((l) => !filled.includes(l)), ...moved])
  ]
  if (same(next, before)) return
  const mcp = { ...store.mcp }
  if (next.length > 0) mcp[serverId] = next
  else delete mcp[serverId]
  writeStore({ ...store, mcp })
}

/**
 * Forget every recorded move — a data reset (`DELETE /api/v1/db-io/reset`)
 * starts the re-entry prompts over (S3 minor).
 */
export function forgetAllMovedSecrets(): void {
  writeStore({ settings: [], mcp: {} })
}

export function forgetMcpServerMoves(serverId: string): void {
  const store = readStore()
  if (!store.mcp[serverId]) return
  const mcp = { ...store.mcp }
  delete mcp[serverId]
  writeStore({ ...store, mcp })
}

type McpRowForStatus = Parameters<typeof mcpSecretLabels>[0] & {
  id: string
  name: string
}

const isUnset = (v: unknown) => v === null || v === undefined || v === ''

/**
 * What `needsReentry` adds for moved secrets, against the current (plaintext)
 * settings and MCP rows. Drops — and forgets — any that has a value again, or
 * whose server is gone (a data reset, a delete made elsewhere).
 */
export function pendingMovedSecrets(
  settings: object,
  mcpRows: McpRowForStatus[]
): string[] {
  const store = readStore()
  const settingsLeft = store.settings.filter((p) =>
    isUnset(getAtPath(settings, p))
  )
  const out = [...settingsLeft]
  const mcp: Record<string, string[]> = {}
  for (const [id, labels] of Object.entries(store.mcp)) {
    const row = mcpRows.find((r) => r.id === id)
    if (!row) continue
    const present = mcpSecretLabels(row)
    const left = labels.filter((l) => !present.has(l))
    if (left.length === 0) continue
    mcp[id] = left
    out.push(...left.map((l) => `mcp:${row.name}:${l}`))
  }
  const changed =
    !same(settingsLeft, store.settings) ||
    JSON.stringify(mcp) !== JSON.stringify(store.mcp)
  if (changed) writeStore({ settings: settingsLeft, mcp })
  return out
}
