import type { McpServer } from '../db/schema'

/**
 * Migrate a legacy `mcp-remote` bridge config to a native remote server.
 *
 * A remote, HTTP-based MCP server (Linear's `https://mcp.linear.app/mcp`, any
 * Streamable-HTTP / SSE server) was commonly added before Actovia had a native
 * remote transport by running the `mcp-remote` npm bridge over stdio:
 *
 *   command = "npx", args = ["-y", "mcp-remote", "https://mcp.linear.app/mcp", …]
 *
 * That spawns `npx` as a child process — which ENOENTs in a packaged app whose
 * PATH lacks npm, and, more fundamentally, never uses Actovia's own
 * Streamable-HTTP transport + OAuth flow. This normalization rewrites such a
 * stdio row, **on read**, into an equivalent remote `streamable-http` server
 * pointing at the bridged URL, so it connects through the native transport and
 * authorizes over the built-in OAuth flow — the owner's existing "linear"
 * server starts working with no re-adding.
 *
 * It is deliberately migrate-on-read (not a DB migration): the stored row is
 * left untouched, the secret-at-rest machinery is not disturbed, and if a
 * later build changes the heuristic the stored config is still the source of
 * truth. A save through the MCP form persists whatever the UI shows.
 *
 * Only the exact `npx mcp-remote <url>` shape is matched; any other stdio
 * command (including one whose first positional argument is not an http(s)
 * URL) is returned unchanged.
 */

/** The bridge package name on npm. */
const MCP_REMOTE_PKG = 'mcp-remote'

/** Node package runners that invoke an npm package by name. */
const PACKAGE_RUNNERS = new Set(['npx', 'bunx', 'pnpm', 'yarn'])

/** Flags `npx`/`bunx` accept before the package name (we skip, not drop). */
const RUNNER_FLAGS = new Set([
  '-y',
  '--yes',
  '-q',
  '--quiet',
  // `pnpm dlx mcp-remote …`, `yarn dlx mcp-remote …`
  'dlx',
  // `pnpm exec …`
  'exec'
])

function baseName(command: string): string {
  // `/opt/homebrew/bin/npx` → `npx`; `npx.cmd` → `npx`.
  const last = command.trim().split(/[\\/]/u).pop() ?? command.trim()
  return last.replace(/\.(cmd|exe|bat|ps1)$/iu, '').toLowerCase()
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * The URL an `npx [-y] mcp-remote <url> [extra…]` stdio config bridges to, or
 * `null` when the config is not that shape.
 */
export function mcpRemoteBridgeUrl(
  command: string | null | undefined,
  args: readonly string[] | null | undefined
): string | null {
  if (!command?.trim() || !args || args.length === 0) return null
  if (!PACKAGE_RUNNERS.has(baseName(command))) return null

  // Walk past the runner's own flags/subcommands to the package name.
  let i = 0
  while (i < args.length && RUNNER_FLAGS.has(args[i])) i++
  if (i >= args.length) return null

  // The package token may be `mcp-remote` or `mcp-remote@latest`.
  const pkg = args[i]
  const pkgName = pkg.split('@')[0]
  if (pkgName !== MCP_REMOTE_PKG) return null
  i++

  // Only rewrite the canonical package + URL form. Ignoring bridge arguments
  // such as `--header` here would silently drop its authentication settings.
  return args.length === i + 1 && isHttpUrl(args[i]) ? args[i] : null
}

/**
 * A server row as the transport/OAuth layer should see it: a legacy
 * `npx mcp-remote <url>` stdio row is presented as a remote `streamable-http`
 * server at `<url>`; every other row is returned unchanged. Pure — never
 * mutates the input.
 */
export function normalizeMcpServer(server: McpServer): McpServer {
  const type = server.transportType ?? 'stdio'
  if (type !== 'stdio') return server
  const url = mcpRemoteBridgeUrl(server.command, server.args)
  if (!url) return server
  return {
    ...server,
    transportType: 'streamable-http',
    url,
    // The stdio fields no longer apply to the normalized view.
    command: '',
    args: []
  }
}
