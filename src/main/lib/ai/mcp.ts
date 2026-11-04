import { McpTools } from '@actovia/shared/types/ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import {
  getAllMcpServers,
  getMcpServersByNames
} from '../db/philharmonic-queries'
import type { McpServer } from '../db/schema'
import { logger } from '../logger'
import { mcpDecryptFailures } from '../secrets/at-rest'
import { normalizeMcpServer } from './mcp-normalize'
import { connectionAuthProvider, isRemoteMcpServer } from './mcp-oauth/flow'
import type { McpOAuthProvider } from './mcp-oauth/provider'
import { hasMcpOAuthTokens, markMcpOAuthRequired } from './mcp-oauth/store'
import { prepareStdioSpawn } from './mcp-stdio-env'
import { validateToolArgs } from './utils/tool-validation'

// Cache stores tools, client, and a timestamp for TTL-based expiration.
interface CachedMcp {
  tools: McpTools
  client: Client
  cachedAt: number
}
const mcpCache = new Map<string, CachedMcp>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/** Close and remove a single server from cache. */
export async function invalidateMcpCache(serverName: string) {
  const cached = mcpCache.get(serverName)
  if (cached) {
    cached.client.close().catch((err) => {
      logger.warn('mcp', 'Failed to close MCP client', {
        server: serverName,
        error: err
      })
    })
    mcpCache.delete(serverName)
  }
}

/** Close all connections and clear the entire cache. */
export async function invalidateAllMcpCache() {
  for (const [name, cached] of mcpCache) {
    cached.client.close().catch((err) => {
      logger.warn('mcp', 'Failed to close MCP client', {
        server: name,
        error: err
      })
    })
  }
  mcpCache.clear()
}

/**
 * The transport a server is configured for — and nothing else. An http / sse
 * server without a url is an error, never a stdio fallback (a stale
 * `command` left from an earlier stdio setup would be spawned); a stdio
 * server needs a command (re-review S2 N1).
 *
 * `authProvider`, when given, drives the remote server's OAuth session (it
 * reuses saved tokens and refreshes them silently). It does not open a browser
 * during a connection; the interactive flow runs from the MCP Servers screen.
 *
 * The server is `normalizeMcpServer`'d first, so a legacy `npx mcp-remote <url>`
 * stdio row is built as a native Streamable-HTTP transport — never spawned.
 * For a genuine stdio server, `prepareStdioSpawn` resolves the command on the
 * login-shell PATH on a packaged macOS/Linux run so it does not ENOENT.
 */
export async function createTransport(
  server: McpServer,
  authProvider?: McpOAuthProvider
) {
  const normalized = normalizeMcpServer(server)
  const type = normalized.transportType ?? 'stdio'
  const requestInit = normalized.headers
    ? { headers: normalized.headers as Record<string, string> }
    : undefined

  if (type === 'streamable-http' || type === 'sse') {
    if (!normalized.url?.trim()) {
      throw new Error(`MCP server "${normalized.name}" has no url`)
    }
    return type === 'sse'
      ? new SSEClientTransport(new URL(normalized.url), {
          authProvider,
          requestInit
        })
      : new StreamableHTTPClientTransport(new URL(normalized.url), {
          authProvider,
          requestInit
        })
  }

  if (type !== 'stdio') {
    throw new Error(`MCP server "${normalized.name}" has an unknown transport`)
  }
  if (!normalized.command?.trim()) {
    throw new Error(`MCP server "${normalized.name}" has no command`)
  }
  const plan = await prepareStdioSpawn(
    normalized.command,
    normalized.env as Record<string, string> | null
  )
  return new StdioClientTransport({
    command: plan.command,
    args: (normalized.args as string[]) ?? [],
    env: plan.env
  })
}

/** Whether a remote server's headers already carry an `Authorization` value. */
function hasAuthorizationHeader(server: McpServer): boolean {
  const headers = server.headers as Record<string, string> | null | undefined
  if (!headers) return false
  return Object.entries(headers).some(
    ([key, value]) => key.toLowerCase() === 'authorization' && !!value?.trim()
  )
}

/**
 * The active servers that can be connected as configured: one whose url,
 * args or a secret did not decrypt (another machine, a denied Keychain
 * prompt) is skipped — it stays listed for re-entry
 * (`GET /api/v1/settings/secrets-status`) until the user enters it again.
 */
function connectable(servers: McpServer[]): McpServer[] {
  return servers.filter((s) => {
    if (!s.isActive) return false
    const failed = mcpDecryptFailures(s)
    if (failed.length === 0) return true
    logger.warn(
      'mcp',
      'Skipping an MCP server whose settings did not decrypt',
      {
        server: s.name,
        fields: failed
      }
    )
    return false
  })
}

async function connectMcpServer(server: McpServer): Promise<McpTools> {
  const cached = mcpCache.get(server.name)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.tools
  }
  // Expired entry — close stale connection before reconnecting
  if (cached) {
    cached.client.close().catch(() => {})
    mcpCache.delete(server.name)
  }

  // A remote server (including a legacy `npx mcp-remote <url>` row, which
  // `normalizeMcpServer` presents as Streamable-HTTP) connects through the
  // native transport. The OAuth provider is attached — WITHOUT needing
  // pre-existing tokens — unless the row carries its own Authorization header
  // (a plain Bearer-token remote server, which must keep working untouched).
  // The provider reuses saved tokens and refreshes them silently. A server is
  // marked as requiring OAuth only after its own 401 challenge; open remote
  // servers do not get a misleading authorization prompt.
  const normalized = normalizeMcpServer(server)
  const authProvider =
    isRemoteMcpServer(normalized) &&
    (!hasAuthorizationHeader(normalized) ||
      (await hasMcpOAuthTokens(normalized.id)))
      ? connectionAuthProvider(normalized)
      : undefined
  const transport = await createTransport(server, authProvider)
  const client = new Client({ name: 'actovia', version: '1.0.0' })
  const toolsResult = await (async () => {
    try {
      await client.connect(transport)
      logger.info('mcp', 'MCP server registered', {
        name: server.name,
        transport: server.transportType ?? 'stdio'
      })
      return await client.listTools()
    } catch (error) {
      if (authProvider && error instanceof UnauthorizedError) {
        await markMcpOAuthRequired(normalized.id)
      }
      throw error
    }
  })()

  const agentTools: AgentTool[] = toolsResult.tools.map((mcpTool) => {
    const schema = Type.Unsafe<Record<string, unknown>>(
      (mcpTool.inputSchema as Record<string, unknown>) ?? Type.Object({})
    )

    const agentTool: AgentTool = {
      name: mcpTool.name,
      label: mcpTool.name,
      description: mcpTool.description ?? '',
      parameters: schema,
      execute: async (
        _toolCallId: string,
        params: unknown
      ): Promise<AgentToolResult<unknown>> => {
        const validatedParams = validateToolArgs(
          mcpTool.name,
          params as Record<string, unknown>,
          mcpTool.inputSchema as Record<string, unknown> | undefined
        )
        const result = await client
          .callTool({
            name: mcpTool.name,
            arguments: validatedParams
          })
          .catch(async (error: unknown) => {
            if (authProvider && error instanceof UnauthorizedError) {
              await markMcpOAuthRequired(normalized.id)
            }
            throw error
          })

        const content = result.content as Array<{
          type: string
          text?: string
          data?: string
          mimeType?: string
        }>
        const piContent = content.map((c) => {
          if (c.type === 'image' && c.data) {
            return {
              type: 'image' as const,
              data: c.data,
              mimeType: c.mimeType ?? 'image/png'
            }
          }
          return {
            type: 'text' as const,
            text: c.text ?? JSON.stringify(c)
          }
        })

        return {
          content:
            piContent.length > 0
              ? piContent
              : [{ type: 'text' as const, text: JSON.stringify(result) }],
          details: result
        }
      }
    }

    return agentTool
  })

  const tools: McpTools = {
    mcpServerName: server.name,
    description: server.description || undefined,
    tools: agentTools
  }
  mcpCache.set(server.name, { tools, client, cachedAt: Date.now() })
  return tools
}

/**
 * Get MCP tools for all active servers from the registry.
 */
export async function getMcpTools(): Promise<McpTools[]> {
  const servers = await getAllMcpServers()
  const active = connectable(servers)
  if (active.length === 0) return []

  const results = await Promise.allSettled(
    active.map((s) => connectMcpServer(s))
  )

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      logger.error('mcp', 'Failed to connect MCP server', {
        server: active[i].name,
        error: r.reason
      })
    }
  })

  return results
    .filter(
      (r): r is PromiseFulfilledResult<McpTools> => r.status === 'fulfilled'
    )
    .map((r) => r.value)
}

/**
 * Get MCP tools filtered by server names (for department-scoped execution).
 */
export async function getMcpToolsByNames(names: string[]): Promise<McpTools[]> {
  if (names.length === 0) return []
  const servers = await getMcpServersByNames(names)
  const active = connectable(servers)
  if (active.length === 0) return []

  const results = await Promise.allSettled(
    active.map((s) => connectMcpServer(s))
  )

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      logger.error('mcp', 'Failed to connect MCP server', {
        server: active[i].name,
        error: r.reason
      })
    }
  })

  return results
    .filter(
      (r): r is PromiseFulfilledResult<McpTools> => r.status === 'fulfilled'
    )
    .map((r) => r.value)
}
