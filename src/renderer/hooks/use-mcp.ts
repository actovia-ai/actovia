import { ErrorCode } from '@actovia/shared/constants/error-codes'
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query'

import { toast } from '@/components/ui/toast'
import { refreshSecretsStatus } from '@/hooks/use-secrets-status'
import { i18n } from '@/lib/i18n'
import {
  createMcpServerApi,
  deleteMcpServerApi,
  getMcpServers,
  getMcpTools,
  type McpServerItem,
  updateMcpServerApi
} from '@/services/mcp-service'

const MCP_ROOT = ['mcp'] as const

export const mcpKeys = {
  all: MCP_ROOT,
  servers: [...MCP_ROOT, 'servers'] as const,
  tools: [...MCP_ROOT, 'tools'] as const
}

// A server change can change its tools, so every write marks both leaves.
// Returned, not voided: the mutation then settles after the mounted lists have
// re-read, and the form the caller closes on success never lands on a stale
// list. A failed re-read still resolves (reported by the query cache).
// A write can also fix (or drop) a secret the re-entry notice names.
const refreshMcp = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: mcpKeys.all }),
    refreshSecretsStatus(queryClient)
  ])

// A secret to re-enter is shown under its field by the form (mcp-servers.tsx).
const SHOWN_INLINE = [ErrorCode.SECRET_REENTRY_REQUIRED]

export function useMcpServers() {
  const { data, isLoading } = useQuery({
    queryKey: mcpKeys.servers,
    queryFn: () => getMcpServers()
  })
  return { data, isLoading }
}

// One key for the settings page and the composer's dialog: a single read.
export function useMcpTools() {
  const { data, isLoading } = useQuery({
    queryKey: mcpKeys.tools,
    queryFn: () => getMcpTools()
  })
  return { data, isLoading }
}

export function useCreateMcpServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof createMcpServerApi>[0]) =>
      createMcpServerApi(data),
    // The global mutation handler is the only error surface — a local catch
    // and toast would make one failed write toast twice.
    meta: {
      errorTitle: i18n.t('settings:mcpServers.toast.registerFailed'),
      inlineCodes: SHOWN_INLINE
    },
    onSuccess: (_server, data) => {
      toast.add({
        type: 'success',
        title: i18n.t('settings:mcpServers.toast.registered', {
          name: data.name
        }),
        description: i18n.t('settings:mcpServers.toast.disabledByDefault')
      })
      return refreshMcp(queryClient)
    }
  })
}

export function useUpdateMcpServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data
    }: {
      id: string
      data: Partial<McpServerItem> & { name: string }
    }) => updateMcpServerApi(id, data),
    meta: {
      errorTitle: i18n.t('settings:mcpServers.toast.updateFailed'),
      inlineCodes: SHOWN_INLINE
    },
    onSuccess: (_server, { data }) => {
      toast.add({
        type: 'success',
        title: i18n.t('settings:mcpServers.toast.updated', { name: data.name })
      })
      return refreshMcp(queryClient)
    }
  })
}

export function useDeleteMcpServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (server: Pick<McpServerItem, 'id' | 'name'>) =>
      deleteMcpServerApi(server.id),
    meta: { errorTitle: i18n.t('settings:mcpServers.toast.removeFailed') },
    onSuccess: (_void, server) => {
      toast.add({
        type: 'success',
        title: i18n.t('settings:mcpServers.toast.removed', {
          name: server.name
        })
      })
      return refreshMcp(queryClient)
    }
  })
}

// Its own hook rather than an update of `{ isActive }`: the copy names the
// direction (enabled / disabled), not "updated". The variable is the server as
// it is now; the write flips it.
export function useToggleMcpServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (server: Pick<McpServerItem, 'id' | 'name' | 'isActive'>) =>
      updateMcpServerApi(server.id, { isActive: !server.isActive }),
    meta: { errorTitle: i18n.t('settings:mcpServers.toast.toggleFailed') },
    onSuccess: (_server, server) => {
      toast.add({
        type: 'success',
        title: i18n.t(
          server.isActive
            ? 'settings:mcpServers.toast.disabled'
            : 'settings:mcpServers.toast.enabled',
          { name: server.name }
        )
      })
      return refreshMcp(queryClient)
    }
  })
}
