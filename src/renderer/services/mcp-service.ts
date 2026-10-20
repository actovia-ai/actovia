import { fetcher } from '@actovia/shared/utils/http'

const BASE = '/api/v1/mcp'

export type McpTransportType = 'stdio' | 'sse' | 'streamable-http'

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

export const getMcpServers = () => fetcher<McpServerItem[]>(BASE)

export const getMcpTools = () =>
  fetcher<{ tools: McpToolsGroup[] }>(`${BASE}/tools`)

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
