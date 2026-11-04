import { asc, eq, inArray } from 'drizzle-orm'

import { addLogSecrets } from '../logger/secret-mask'
import { secretSafeWriteError } from '../secrets'
import {
  decryptMcpRow,
  encryptMcpSecrets,
  keepStoredMcpForms
} from '../secrets/at-rest'
import { forgetMcpServerMoves } from '../secrets/moved'
import {
  clearMcpDecryptFailures,
  forgetMcpServer,
  recordMcpDecryptFailures
} from '../secrets/status'
import { mcpServerSecretValues } from '../secrets/values'
import { db } from './db'
import { mcpServer, type McpServer } from './schema'

/**
 * `env` / `headers` values and secret-named `extraConfig` values are stored
 * encrypted (spec 2026-09-25 §2.3). Every read here hands out plaintext; a
 * value that will not decrypt is left out and reported for re-entry.
 */
function decrypted(row: McpServer): McpServer
function decrypted(row: McpServer | undefined): McpServer | undefined
function decrypted(row: McpServer | undefined): McpServer | undefined {
  if (!row) return row
  const { plain, undecryptable } = decryptMcpRow(row)
  // The logger masks these from now on (M4).
  addLogSecrets(mcpServerSecretValues(plain))
  recordMcpDecryptFailures(
    row.id,
    undecryptable.map((label) => `mcp:${row.name}:${label}`)
  )
  return plain
}

export async function getAllMcpServers() {
  const rows = await db
    .select()
    .from(mcpServer)
    .orderBy(asc(mcpServer.createdAt))
  clearMcpDecryptFailures()
  return rows.map((r) => decrypted(r))
}

export async function getMcpServerById(id: string) {
  const [result] = await db.select().from(mcpServer).where(eq(mcpServer.id, id))
  return decrypted(result)
}

export async function getMcpServersByNames(names: string[]) {
  const rows = await db
    .select()
    .from(mcpServer)
    .where(inArray(mcpServer.name, names))
  return rows.map((r) => decrypted(r))
}

// Writes rethrow a secret-safe error: the driver's message quotes every
// parameter, `env` / `headers` values included.
// Encryption runs before the `try`: a Keychain refusal surfaces as its own
// value-free `SecretEncryptionError`, not as a generic write failure.
export async function createMcpServer(data: typeof mcpServer.$inferInsert) {
  const { sealed } = encryptMcpSecrets(data)
  try {
    const [result] = await db.insert(mcpServer).values(sealed).returning()
    return decrypted(result)
  } catch (error) {
    throw secretSafeWriteError('Failed to create MCP server', error)
  }
}

export async function updateMcpServer(
  id: string,
  data: Partial<typeof mcpServer.$inferInsert>
) {
  // Keep, as stored, what did not decrypt and what the write left unchanged
  // (rulings R2-1 / R2-2) — so a save never unlocks a row it cannot read,
  // nor writes a key that is an envelope at rest back in the clear.
  const [raw] = await db.select().from(mcpServer).where(eq(mcpServer.id, id))
  const { sealed } = encryptMcpSecrets(
    raw ? keepStoredMcpForms(data, raw) : data
  )
  try {
    const [result] = await db
      .update(mcpServer)
      .set({ ...sealed, updatedAt: new Date() })
      .where(eq(mcpServer.id, id))
      .returning()
    return decrypted(result)
  } catch (error) {
    throw secretSafeWriteError('Failed to update MCP server', error)
  }
}

export async function deleteMcpServer(id: string) {
  forgetMcpServer(id)
  forgetMcpServerMoves(id)
  return db.delete(mcpServer).where(eq(mcpServer.id, id))
}

/**
 * Store (or clear) a server's OAuth state under `extraConfig.oauth`. Written
 * by the MCP OAuth flow as it registers a client and persists tokens — not by
 * the user-facing create/update, so it bypasses the "a moved destination
 * clears secrets" rule (`planMcpUpdate`): a token save must never wipe the very
 * tokens it is saving. The `oauth` object's `tokens` and any `client_secret`
 * are secret-named, so `encryptMcpSecrets` seals them at rest like every other
 * `extraConfig` secret; `getMcpServerById` hands them back decrypted.
 *
 * `oauth === undefined` removes the key, leaving the rest of `extraConfig`
 * untouched.
 */
export async function setMcpOAuthConfig(
  id: string,
  oauth: Record<string, unknown> | undefined
) {
  const current = await getMcpServerById(id)
  if (!current) return
  const extraConfig: Record<string, unknown> = { ...current.extraConfig }
  if (oauth === undefined) delete extraConfig.oauth
  else extraConfig.oauth = oauth
  const next = Object.keys(extraConfig).length > 0 ? extraConfig : null
  const { sealed } = encryptMcpSecrets({ extraConfig: next })
  try {
    const [result] = await db
      .update(mcpServer)
      .set({ extraConfig: sealed.extraConfig, updatedAt: new Date() })
      .where(eq(mcpServer.id, id))
      .returning()
    return decrypted(result)
  } catch (error) {
    throw secretSafeWriteError('Failed to persist MCP OAuth state', error)
  }
}
