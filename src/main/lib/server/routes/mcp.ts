import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { AppError } from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  getMcpTools,
  invalidateAllMcpCache,
  invalidateMcpCache
} from '../../ai/mcp'
import {
  cancelMcpAuthorization,
  getMcpAuthStatus,
  signOutMcpServer,
  startMcpAuthorization
} from '../../ai/mcp-oauth'
import {
  createMcpServer,
  deleteMcpServer,
  getAllMcpServers,
  getMcpServerById,
  updateMcpServer
} from '../../db/mcp-queries'
import {
  maskMcpServer,
  mcpPlaintext,
  refuseMasksOnCreate,
  restoreMcpSecrets
} from '../../secrets'
import { mcpSecretLabels, planMcpUpdate } from '../../secrets/at-rest'
import { recordMcpWrite } from '../../secrets/moved'
import { Variables } from '../types'
import {
  deletionSuccessResponse,
  getRequiredParam,
  handleDatabaseOperation,
  successResponse,
  validateSchema
} from '../utils'

const mcp = new Hono<{ Variables: Variables }>()

const mcpServerSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  transportType: z.enum(['stdio', 'sse', 'streamable-http']).optional(),
  // stdio fields
  command: z.string().optional().nullable(),
  args: z.array(z.string()).optional().nullable(),
  env: z.record(z.string(), z.string()).optional().nullable(),
  // remote fields
  url: z.string().optional().nullable(),
  headers: z.record(z.string(), z.string()).optional().nullable(),
  // arbitrary extra fields merged into JSON export (e.g. oauth, httpUrl)
  extraConfig: z.record(z.string(), z.unknown()).optional().nullable(),
  isActive: z.boolean().optional()
})

mcp.get('/', async (c) => {
  const servers = await handleDatabaseOperation(
    () => getAllMcpServers(),
    'Failed to get MCP servers'
  )
  // `env` / `headers` values (and secret-named `extraConfig` values) leave as
  // masks only (spec 2026-09-25 §2.2); a posted mask means "unchanged".
  // `authStatus` tells the Servers screen whether a remote, OAuth-capable
  // server still needs the browser authorization flow.
  const masked = await Promise.all(
    servers.map(async (s) => ({
      ...maskMcpServer(s),
      authStatus: await getMcpAuthStatus(s)
    }))
  )
  return successResponse(c, masked)
})

mcp.post('/', async (c) => {
  const data = validateSchema(
    mcpServerSchema,
    await c.req.json(),
    'Invalid MCP server data'
  )
  // Nothing is stored yet, so a mask here has nothing to stand for (N2).
  refuseMasksOnCreate(data)
  const result = await handleDatabaseOperation(
    () => createMcpServer(restoreMcpSecrets(data, mcpPlaintext(null))),
    'Failed to create MCP server'
  )
  invalidateAllMcpCache()
  return successResponse(c, result && maskMcpServer(result), 201)
})

mcp.put('/:id', async (c) => {
  const id = getRequiredParam(c, 'id')
  const data = validateSchema(
    mcpServerSchema.partial(),
    await c.req.json(),
    'Invalid MCP server data'
  )
  // Invalidate old name before update (name might change)
  const servers = await getAllMcpServers()
  const old = servers.find((s) => s.id === id)
  if (old) invalidateMcpCache(old.name)

  // Masked url / args / secrets posted back stand for the stored ones, but
  // no stored secret follows a move of its destination (prepareMcpUpdate).
  const stored = await getMcpServerById(id)
  const plan = planMcpUpdate(data, stored)
  if (plan.moved.has('extraConfig')) {
    await cancelMcpAuthorization(id)
    const extraConfig = plan.write.extraConfig
    const oauth = extraConfig?.oauth
    if (
      extraConfig &&
      typeof oauth === 'object' &&
      oauth !== null &&
      !Array.isArray(oauth)
    ) {
      plan.write.extraConfig = {
        ...extraConfig,
        oauth: Object.fromEntries(
          Object.entries(oauth).filter(([key]) => key !== 'required')
        )
      }
    }
  }
  const result = await handleDatabaseOperation(
    () => updateMcpServer(id, plan.write),
    'Failed to update MCP server'
  )
  // A secret dropped because its destination moved is asked for again, by
  // name, across restarts (`secrets/moved.ts`); one typed again drops off.
  if (stored && result) {
    const after = mcpSecretLabels(result)
    const moved = [...mcpSecretLabels(stored)].filter(
      (label) =>
        plan.moved.has(label.split('.')[0] as never) && !after.has(label)
    )
    recordMcpWrite(id, { moved, filled: [...after] })
  }
  if (data.name) invalidateMcpCache(data.name)
  return successResponse(c, result && maskMcpServer(result))
})

mcp.delete('/:id', async (c) => {
  const id = getRequiredParam(c, 'id')
  const servers = await getAllMcpServers()
  const target = servers.find((s) => s.id === id)

  await cancelMcpAuthorization(id)
  await handleDatabaseOperation(
    () => deleteMcpServer(id),
    'Failed to delete MCP server'
  )
  if (target) invalidateMcpCache(target.name)
  return deletionSuccessResponse(c, 'MCP server')
})

// Begin the browser OAuth authorization flow for a remote MCP server. Opens
// the provider's consent page in the system browser, listens on a loopback
// callback, exchanges the code for tokens (PKCE) and persists them. Resolves
// once authorization completes (the request is held for the length of the
// flow); the renderer shows a spinner meanwhile.
mcp.post('/:id/authorize', async (c) => {
  const id = getRequiredParam(c, 'id')
  try {
    await startMcpAuthorization(id)
  } catch (err) {
    throw new AppError(
      ErrorCode.SERVICE_MCP_FAILED,
      err instanceof Error ? err.message : 'MCP authorization failed'
    )
  }
  // New tokens mean a stale cached (unauthorized) connection — drop it so the
  // next tool read reconnects with them.
  const server = await getMcpServerById(id)
  if (server) invalidateMcpCache(server.name)
  return successResponse(c, { success: true })
})

// Sign out of a remote MCP server: forget its stored tokens and registration.
mcp.delete('/:id/authorize', async (c) => {
  const id = getRequiredParam(c, 'id')
  await signOutMcpServer(id)
  const server = await getMcpServerById(id)
  if (server) invalidateMcpCache(server.name)
  return deletionSuccessResponse(c, 'MCP authorization')
})

// List available tools from all active MCP servers
mcp.get('/tools', async (c) => {
  const tools = await getMcpTools()
  const servers = await getAllMcpServers()
  const authStatusById = Object.fromEntries(
    await Promise.all(
      servers.map(async (server) => [server.id, await getMcpAuthStatus(server)])
    )
  )
  return successResponse(c, {
    tools: tools.map((t) => ({
      mcpServerName: t.mcpServerName,
      tools: t.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? ''
      }))
    })),
    authStatusById
  })
})

export default mcp
