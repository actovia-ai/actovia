import { fetcher } from '@actovia/shared/utils/http'

const BASE = '/api/v1/mcp'

export type McpTransportType = 'stdio' | 'sse' | 'streamable-http'

/**
 * A remote server's OAuth state (see `/api/v1/mcp/:id/authorize`):
 * `not-applicable` for stdio/local, `unauthorized` until the browser flow runs,
 * `authorizing` while it is running, `authorized` once tokens are stored.
 */
export type McpAuthStatus =
  | 'not-applicable'
  | 'unknown'
  | 'unauthorized'
  | 'authorizing'
  | 'authorized'

export interface McpServerItem {
  id: string
  name: string
  description: string | null
  transportType: McpTransportType
  // stdio
  command: string
  args: string[]
  env: Record<string, string> | null
  // remote
  url: string | null
  headers: Record<string, string> | null
  extraConfig: Record<string, unknown> | null
  isActive: boolean | null
  authStatus: McpAuthStatus
  createdAt: string
  updatedAt: string
}

export interface McpToolInfo {
  name: string
  description: string
}

export interface McpToolsGroup {
  mcpServerName: string
  tools: McpToolInfo[]
}

export interface McpToolsResponse {
  tools: McpToolsGroup[]
  authStatusById: Record<string, McpAuthStatus>
}

export const getMcpServers = () => fetcher<McpServerItem[]>(BASE)

export const getMcpTools = () => fetcher<McpToolsResponse>(`${BASE}/tools`)

export const createMcpServerApi = (
  data: Partial<McpServerItem> & { name: string }
) => fetcher<McpServerItem>(BASE, { method: 'POST', body: data as never })

export const updateMcpServerApi = (id: string, data: Partial<McpServerItem>) =>
  fetcher<McpServerItem>(`${BASE}/${id}`, {
    method: 'PUT',
    body: data as never
  })

export const deleteMcpServerApi = (id: string) =>
  fetcher<void>(`${BASE}/${id}`, { method: 'DELETE' })

/**
 * Start the browser OAuth flow for a remote server. The promise resolves once
 * the user has approved and tokens are stored (it is held for the length of the
 * flow), or rejects if they deny / it times out.
 */
export const authorizeMcpServerApi = (id: string) =>
  fetcher<{ success: true }>(`${BASE}/${id}/authorize`, { method: 'POST' })

/** Sign out of a remote server: clears its stored OAuth tokens. */
export const signOutMcpServerApi = (id: string) =>
  fetcher<void>(`${BASE}/${id}/authorize`, { method: 'DELETE' })
