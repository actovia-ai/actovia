import { isAbsolute } from 'node:path'

import { app } from 'electron'

import { findOnPath } from '../agents/cli-check'
import { loginShellEnv, scrubEnv } from '../agents/login-shell'
import { logger } from '../logger'

/**
 * Hardening for stdio MCP servers in a packaged, Finder/Dock-launched app.
 *
 * A GUI-launched Electron app on macOS inherits launchd's minimal PATH — it
 * lacks `/usr/local/bin`, Homebrew (`/opt/homebrew/bin`) and nvm paths — so a
 * stdio MCP server spawned as a bare `npx` / `node` / `uvx` child fails with a
 * raw `spawn npx … ENOENT`. We reuse the agents' login-shell resolver
 * (`loginShellEnv`, cached once per run; already used to find the Claude/Codex
 * CLIs) to recover the owner's real PATH, pass it to the child, and resolve a
 * bare command to an absolute path before the spawn.
 *
 * Applied only on macOS/Linux packaged runs. On Windows (PATH is already
 * inherited sensibly and the login-shell dump does not apply) and in dev
 * (`bun run dev` already has a good PATH) the stdio config is used verbatim.
 */

/** Whether PATH hardening should run for this platform + build. */
export function shouldHardenStdioPath(): boolean {
  if (process.platform === 'win32') return false
  return app.isPackaged
}

export interface StdioSpawnPlan {
  /** The command to spawn — resolved to an absolute path when it was bare. */
  command: string
  /** The environment for the child, PATH augmented with the login-shell PATH. */
  env: Record<string, string>
}

/**
 * Prepare a stdio MCP server's command + environment for spawning.
 *
 * - On Windows / dev: returns the command unchanged and the inherited env
 *   merged with the server row's own `env`, leaving platform behaviour alone.
 * - On a packaged macOS/Linux run: merges the login-shell PATH into the child
 *   env and, when `command` is a bare name, resolves it to an absolute path on
 *   that PATH. If a bare command cannot be resolved, throws a clear error
 *   naming the missing binary — far better than a raw ENOENT.
 *
 * `configuredEnv` is the server row's own `env` (never overwritten; it wins for
 * any key it sets, PATH included if the user set one explicitly).
 */
export async function prepareStdioSpawn(
  command: string,
  configuredEnv?: Record<string, string> | null
): Promise<StdioSpawnPlan> {
  const trimmed = command.trim()
  const baseEnv = scrubEnv(process.env)
  const configured = configuredEnv ?? {}

  if (!shouldHardenStdioPath()) {
    return {
      command: trimmed,
      env: { ...baseEnv, ...configured }
    }
  }

  const shellEnv = await loginShellEnv()
  // The login-shell PATH first, then the inherited one, so a path the user's
  // shell knows about wins. A PATH the server config sets explicitly wins over
  // both.
  const mergedPath = [shellEnv.PATH, baseEnv.PATH].filter(Boolean).join(':')
  const env: Record<string, string> = {
    ...baseEnv,
    ...shellEnv,
    ...configured
  }
  env.PATH = configured.PATH ?? mergedPath

  // An absolute or explicitly-relative command is spawned as given.
  if (isAbsolute(trimmed) || trimmed.includes('/')) {
    return { command: trimmed, env }
  }

  const resolved = await findOnPath(trimmed, env.PATH ?? '')
  if (!resolved) {
    logger.error('mcp', 'MCP stdio command not found on PATH', {
      command: trimmed
    })
    throw new Error(
      `MCP server command "${trimmed}" was not found on PATH. ` +
        `Install it, or set the server's command to its full path.`
    )
  }
  return { command: resolved, env }
}
