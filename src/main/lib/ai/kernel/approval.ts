import { join } from 'path'

import {
  type ApprovalTarget,
  createGuard,
  forModel
} from '@actovia-ai/agent-guard'
import { LAN_SERVER_PORT, SERVER_PORT } from '@actovia/shared/constants/systems'
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'

import { GREP_SKIP_DIRS } from '../calling-tools/grep-skip-dirs'

/**
 * The approval gate for secrets outside Actovia (spec 2026-09-25 §2.5). The
 * matcher is `@actovia-ai/agent-guard` (packages/agent-guard, ISSUE-270);
 * what is Actovia's is the configuration below.
 *
 * Actovia's own secrets are defended without exception elsewhere (encrypted at
 * rest, masked by the API). Secrets elsewhere on the machine — SSH keys, cloud
 * credentials, `.env` files — are sometimes exactly what a task needs, so a
 * tool call that touches one is paused and the user decides: `sensitiveTarget`
 * says which calls, `pending-approvals.ts` holds each paused call until a decision
 * (`POST /api/v1/chat/approval`), a timeout or Stop settles it.
 *
 * Some of Actovia's own files are never the user's decision, and a call that
 * touches them is refused without asking: `~/.actovia/lock.dat` (the PIN
 * secret), `~/.actovia/tls/` (the LAN certificate's key), and the raw data —
 * `~/.actovia/database` (PGlite), `~/.actovia/backups` (its archives) and
 * `~/.actovia/analytics` (the DuckDB copy). Those last three are ciphertext
 * only while encryption at rest is on: a backup written before it existed,
 * and every file while `safeStorage` is unavailable, holds keys in plaintext
 * — and no tool has a use for raw database files (chats are read through
 * `lcm_*`). The rest of `~/.actovia` (the chat workspaces, media, logs) stays
 * readable. `call_mcp_tool` aimed at Actovia's own API ports is refused too.
 */

export {
  type ApprovalTarget,
  type CappedSummary,
  capSummary,
  declinedReason,
  sanitizeSummary,
  type SensitiveKind,
  type SensitiveTarget
} from '@actovia-ai/agent-guard'

export interface MatchEnv {
  home: string
  actoviaHome: string
  /** Where a relative path given to a file tool lands (the process's cwd). */
  cwd: string
  /** Whether the filesystem ignores case. Defaults to the platform. */
  caseInsensitive?: boolean
}

const guard = createGuard({
  appName: 'Actovia',
  appDirName: '.actovia',
  defaultAppHome: (home) => process.env.ACTOVIA_HOME || join(home, '.actovia'),
  refused: ['lock.dat', 'tls', 'database', 'backups', 'analytics'],
  ownPorts: [SERVER_PORT, LAN_SERVER_PORT],
  tools: {
    paths: {
      [TOOL_NAMES.readFile]: 'path',
      [TOOL_NAMES.writeFile]: 'path',
      [TOOL_NAMES.editFile]: 'path',
      [TOOL_NAMES.listDirectory]: 'path',
      [TOOL_NAMES.grep]: 'path',
      [TOOL_NAMES.findFiles]: 'searchPath'
    },
    recursive: [TOOL_NAMES.grep],
    terminal: TOOL_NAMES.terminal,
    mcpCall: TOOL_NAMES.callMcpTool
  },
  skipDirs: GREP_SKIP_DIRS
})

/**
 * Whether a tool call touches a secret outside Actovia (`ask`), one of
 * Actovia's own that is never handed out (`refuse`), or neither (null).
 * `workspaceDir` is the chat's workspace: secret-named files inside it are
 * the model's own and pass. `env` is for tests.
 */
export function sensitiveTarget(
  toolName: string,
  args: unknown,
  workspaceDir?: string,
  env?: MatchEnv
): Promise<ApprovalTarget | null> {
  return guard.sensitiveTarget(
    toolName,
    args,
    workspaceDir,
    env && {
      home: env.home,
      appHome: env.actoviaHome,
      cwd: env.cwd,
      caseInsensitive: env.caseInsensitive
    }
  )
}

/** What a Philharmonic Group run reads: no one can approve there. */
export function groupRefusedReason(summary: string): string {
  return `Access to ${forModel(summary)} is not available in a Group run.`
}

/** What the model reads for Actovia's own files (lock, TLS key, database,
 *  backups) and API. */
export const refusedReason = guard.refusedReason
