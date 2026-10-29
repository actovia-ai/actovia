// @vitest-environment happy-dom
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement, Fragment } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../helpers/query-test-utils'

const getMcpServersService = vi.fn()
const getMcpToolsService = vi.fn()
const createMcpServerService = vi.fn()
const updateMcpServerService = vi.fn()
const deleteMcpServerService = vi.fn()
vi.mock('@/services/mcp-service', () => ({
  getMcpServers: (...args: unknown[]) => getMcpServersService(...args),
  getMcpTools: (...args: unknown[]) => getMcpToolsService(...args),
  createMcpServerApi: (...args: unknown[]) => createMcpServerService(...args),
  updateMcpServerApi: (...args: unknown[]) => updateMcpServerService(...args),
  deleteMcpServerApi: (...args: unknown[]) => deleteMcpServerService(...args)
}))
// `key[name]` when the copy is interpolated, so a wrong name or a wrong key
// both show in the assertion.
vi.mock('@/lib/i18n', () => ({
  i18n: {
    t: (key: string, params?: { name?: string }) =>
      params ? `${key}[${params.name}]` : key
  }
}))
const report = vi.fn()
vi.mock('@/lib/report-error', () => ({
  reportRendererError: (...args: unknown[]) => report(...args)
}))
const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('@/components/ui/toast', () => {
  // `toast.add({ type, ...options })` → the spy for that type.
  const byType: Record<string, (options: unknown) => void> = {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args)
  }
  return {
    toast: {
      add: ({ type, ...options }: { type: string }) => byType[type]?.(options)
    }
  }
})

const {
  mcpKeys,
  useMcpServers,
  useMcpTools,
  useCreateMcpServer,
  useUpdateMcpServer,
  useDeleteMcpServer,
  useToggleMcpServer
} = await import('@/hooks/use-mcp')
const { createAppQueryClient } = await import('@/lib/query-client')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function Probe<T>({
  hook,
  onReady
}: {
  hook: () => T
  onReady: (value: T) => void
}) {
  onReady(hook())
  return null
}

async function mountHook<T>(hook: () => T) {
  let latest: T | undefined
  const { queryClient } = await renderWithQueryClient(
    createElement(Probe<T>, { hook, onReady: (value) => (latest = value) })
  )
  return { queryClient, api: () => latest! }
}

// The app's own client, so a failing read or write goes through the real
// `queryCache` / `mutationCache` `onError` (report, and toast for a write).
// Retries off so a failed read lands without a backoff.
async function mountHookOnAppClient<T>(hook: () => T) {
  let latest: T | undefined
  const queryClient = createAppQueryClient()
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false }
  })
  const probe = createElement(Probe<T>, {
    hook,
    onReady: (value) => (latest = value)
  })
  await act(async () => {
    createRoot(document.createElement('div')).render(
      createElement(QueryClientProvider, { client: queryClient }, probe)
    )
  })
  return { queryClient, api: () => latest! }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const server = {
  id: 's1',
  name: 'filesystem',
  description: null,
  transportType: 'stdio' as const,
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
  env: null,
  url: null,
  headers: null,
  extraConfig: null,
  isActive: false,
  createdAt: '2026-09-23T03:00:00.000Z',
  updatedAt: '2026-09-23T03:00:00.000Z'
}
const servers = [server]
const tools = {
  tools: [
    {
      mcpServerName: 'filesystem',
      tools: [{ name: 'read_file', description: 'Read a file' }]
    }
  ]
}
const draft = {
  name: 'filesystem',
  description: null,
  transportType: 'stdio' as const,
  command: 'npx',
  args: ['-y'],
  env: null,
  extraConfig: null
}

function seedCaches(queryClient: QueryClient) {
  queryClient.setQueryData(mcpKeys.servers, servers)
  queryClient.setQueryData(mcpKeys.tools, tools)
  queryClient.setQueryData(['usage'], { totalCost: 0 })
}

const isInvalidated = (queryClient: QueryClient, key: readonly unknown[]) =>
  queryClient.getQueryState(key)?.isInvalidated

// A server change can change its tools, so both leaves go stale together.
function expectMcpFamilyInvalidated(queryClient: QueryClient) {
  expect(isInvalidated(queryClient, mcpKeys.servers)).toBe(true)
  expect(isInvalidated(queryClient, mcpKeys.tools)).toBe(true)
  expect(isInvalidated(queryClient, ['usage'])).toBe(false)
}

function expectNothingInvalidated(queryClient: QueryClient) {
  expect(isInvalidated(queryClient, mcpKeys.servers)).toBe(false)
  expect(isInvalidated(queryClient, mcpKeys.tools)).toBe(false)
  expect(isInvalidated(queryClient, ['usage'])).toBe(false)
}

// One toast, from the global handler, plus one report: a second toast would
// be a local catch doubling it.
function expectSingleGlobalFailure(title: string, message: string) {
  expect(report).toHaveBeenCalledTimes(1)
  expect(report).toHaveBeenCalledWith('mutation', expect.any(Error), {
    mutationKey: undefined
  })
  expect(toastError).toHaveBeenCalledTimes(1)
  expect(toastError).toHaveBeenCalledWith({ title, description: message })
  expect(toastSuccess).not.toHaveBeenCalled()
}

afterEach(() => {
  getMcpServersService.mockReset()
  getMcpToolsService.mockReset()
  createMcpServerService.mockReset()
  updateMcpServerService.mockReset()
  deleteMcpServerService.mockReset()
  report.mockClear()
  toastSuccess.mockClear()
  toastError.mockClear()
})

describe('mcpKeys', () => {
  it('nests servers and tools as sibling leaves under one mcp root', () => {
    expect(mcpKeys.all).toEqual(['mcp'])
    expect(mcpKeys.servers).toEqual(['mcp', 'servers'])
    expect(mcpKeys.tools).toEqual(['mcp', 'tools'])
  })
})

describe('useMcpServers', () => {
  it('reads the servers once and caches them at mcpKeys.servers', async () => {
    getMcpServersService.mockResolvedValue(servers)
    const { queryClient, api } = await mountHook(useMcpServers)
    expect(api().isLoading).toBe(true)
    expect(api().data).toBeUndefined()

    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(servers))
    })

    expect(getMcpServersService).toHaveBeenCalledTimes(1)
    expect(getMcpServersService).toHaveBeenCalledWith()
    expect(getMcpToolsService).not.toHaveBeenCalled()
    expect(api().isLoading).toBe(false)
    expect(queryClient.getQueryData(mcpKeys.servers)).toEqual(servers)
  })

  it('a failed read is reported and never toasted, and leaves the data undefined', async () => {
    getMcpServersService.mockRejectedValue(new Error('mcp is down'))
    const { api } = await mountHookOnAppClient(useMcpServers)

    await act(async () => {
      await vi.waitFor(() => expect(api().isLoading).toBe(false))
    })

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: mcpKeys.servers
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
  })
})

describe('useMcpTools', () => {
  it('reads the tools once and caches them at mcpKeys.tools', async () => {
    getMcpToolsService.mockResolvedValue(tools)
    const { queryClient, api } = await mountHook(useMcpTools)
    expect(api().isLoading).toBe(true)
    expect(api().data).toBeUndefined()

    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(tools))
    })

    expect(getMcpToolsService).toHaveBeenCalledTimes(1)
    expect(getMcpToolsService).toHaveBeenCalledWith()
    expect(getMcpServersService).not.toHaveBeenCalled()
    expect(api().isLoading).toBe(false)
    expect(queryClient.getQueryData(mcpKeys.tools)).toEqual(tools)
  })

  it('is one shared query: the settings page and the composer read the tools with one call', async () => {
    getMcpToolsService.mockResolvedValue(tools)
    let settingsPage: ReturnType<typeof useMcpTools> | undefined
    let composer: ReturnType<typeof useMcpTools> | undefined
    await renderWithQueryClient(
      createElement(
        Fragment,
        null,
        createElement(Probe<ReturnType<typeof useMcpTools>>, {
          hook: useMcpTools,
          onReady: (value) => (settingsPage = value)
        }),
        createElement(Probe<ReturnType<typeof useMcpTools>>, {
          hook: useMcpTools,
          onReady: (value) => (composer = value)
        })
      )
    )

    await act(async () => {
      await vi.waitFor(() => {
        expect(settingsPage!.data).toEqual(tools)
        expect(composer!.data).toEqual(tools)
      })
    })

    expect(getMcpToolsService).toHaveBeenCalledTimes(1)
  })

  it('a failed read is reported and never toasted, and leaves the data undefined', async () => {
    getMcpToolsService.mockRejectedValue(new Error('tools are down'))
    const { api } = await mountHookOnAppClient(useMcpTools)

    await act(async () => {
      await vi.waitFor(() => expect(api().isLoading).toBe(false))
    })

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: mcpKeys.tools
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
  })
})

describe('useCreateMcpServer', () => {
  it('creates with the draft alone, toasts the registered name once, and marks the mcp family stale', async () => {
    createMcpServerService.mockResolvedValue(server)
    const { queryClient, api } = await mountHook(useCreateMcpServer)
    seedCaches(queryClient)

    await act(async () => {
      await api().mutateAsync(draft)
    })

    // React Query hands a mutationFn (variables, context); the service takes
    // the draft alone.
    expect(createMcpServerService).toHaveBeenCalledTimes(1)
    expect(createMcpServerService).toHaveBeenCalledWith(draft)
    expectMcpFamilyInvalidated(queryClient)
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith({
      title: 'settings:mcpServers.toast.registered[filesystem]',
      description: 'settings:mcpServers.toast.disabledByDefault'
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('a failed create reaches the global handler only: one report, one toast, nothing invalidated', async () => {
    createMcpServerService.mockRejectedValue(new Error('name already taken'))
    const { queryClient, api } = await mountHookOnAppClient(useCreateMcpServer)
    seedCaches(queryClient)

    await act(async () => {
      await api()
        .mutateAsync(draft)
        .catch(() => {})
    })

    expectNothingInvalidated(queryClient)
    expectSingleGlobalFailure(
      'settings:mcpServers.toast.registerFailed',
      'name already taken'
    )
  })
})

describe('useUpdateMcpServer', () => {
  it('updates the server with its id and the draft, toasts the updated name once, and marks the mcp family stale', async () => {
    updateMcpServerService.mockResolvedValue(server)
    const { queryClient, api } = await mountHook(useUpdateMcpServer)
    seedCaches(queryClient)

    await act(async () => {
      await api().mutateAsync({ id: 's1', data: draft })
    })

    expect(updateMcpServerService).toHaveBeenCalledTimes(1)
    expect(updateMcpServerService).toHaveBeenCalledWith('s1', draft)
    expectMcpFamilyInvalidated(queryClient)
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith({
      title: 'settings:mcpServers.toast.updated[filesystem]'
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('a failed update reaches the global handler only: one report, one toast, nothing invalidated', async () => {
    updateMcpServerService.mockRejectedValue(new Error('server not found'))
    const { queryClient, api } = await mountHookOnAppClient(useUpdateMcpServer)
    seedCaches(queryClient)

    await act(async () => {
      await api()
        .mutateAsync({ id: 's1', data: draft })
        .catch(() => {})
    })

    expectNothingInvalidated(queryClient)
    expectSingleGlobalFailure(
      'settings:mcpServers.toast.updateFailed',
      'server not found'
    )
  })

  it('a secret the server asks for again is left to the form: reported, never toasted', async () => {
    const { HttpError } = await import('@actovia/shared/utils/http')
    updateMcpServerService.mockRejectedValue(
      new HttpError(400, 'SECRET_REENTRY_REQUIRED', 're-enter', {
        field: 'args'
      })
    )
    const { api } = await mountHookOnAppClient(useUpdateMcpServer)
    let thrown: unknown
    await act(async () => {
      await api()
        .mutateAsync({ id: 's1', data: draft })
        .catch((e: unknown) => {
          thrown = e
        })
    })
    expect((thrown as { code?: string }).code).toBe('SECRET_REENTRY_REQUIRED')
    expect(report).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe('useDeleteMcpServer', () => {
  it('deletes by id alone, toasts the removed name once, and marks the mcp family stale', async () => {
    deleteMcpServerService.mockResolvedValue()
    const { queryClient, api } = await mountHook(useDeleteMcpServer)
    seedCaches(queryClient)

    await act(async () => {
      await api().mutateAsync(server)
    })

    expect(deleteMcpServerService).toHaveBeenCalledTimes(1)
    expect(deleteMcpServerService).toHaveBeenCalledWith('s1')
    expectMcpFamilyInvalidated(queryClient)
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith({
      title: 'settings:mcpServers.toast.removed[filesystem]'
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('a failed delete reaches the global handler only: one report, one toast, nothing invalidated', async () => {
    deleteMcpServerService.mockRejectedValue(new Error('server is busy'))
    const { queryClient, api } = await mountHookOnAppClient(useDeleteMcpServer)
    seedCaches(queryClient)

    await act(async () => {
      await api()
        .mutateAsync(server)
        .catch(() => {})
    })

    expectNothingInvalidated(queryClient)
    expectSingleGlobalFailure(
      'settings:mcpServers.toast.removeFailed',
      'server is busy'
    )
  })
})

describe('useToggleMcpServer', () => {
  it('switches an inactive server on, toasts enabled once, and marks the mcp family stale', async () => {
    updateMcpServerService.mockResolvedValue(server)
    const { queryClient, api } = await mountHook(useToggleMcpServer)
    seedCaches(queryClient)

    await act(async () => {
      await api().mutateAsync({ ...server, isActive: false })
    })

    expect(updateMcpServerService).toHaveBeenCalledTimes(1)
    expect(updateMcpServerService).toHaveBeenCalledWith('s1', {
      isActive: true
    })
    expectMcpFamilyInvalidated(queryClient)
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith({
      title: 'settings:mcpServers.toast.enabled[filesystem]'
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('reads a server that was never switched (isActive null) as off, so the toggle turns it on', async () => {
    updateMcpServerService.mockResolvedValue(server)
    const { api } = await mountHook(useToggleMcpServer)

    await act(async () => {
      await api().mutateAsync({ ...server, isActive: null })
    })

    expect(updateMcpServerService).toHaveBeenCalledWith('s1', {
      isActive: true
    })
    expect(toastSuccess).toHaveBeenCalledWith({
      title: 'settings:mcpServers.toast.enabled[filesystem]'
    })
  })

  it('switches an active server off, toasts disabled once, and marks the mcp family stale', async () => {
    updateMcpServerService.mockResolvedValue(server)
    const { queryClient, api } = await mountHook(useToggleMcpServer)
    seedCaches(queryClient)

    await act(async () => {
      await api().mutateAsync({ ...server, isActive: true })
    })

    expect(updateMcpServerService).toHaveBeenCalledTimes(1)
    expect(updateMcpServerService).toHaveBeenCalledWith('s1', {
      isActive: false
    })
    expectMcpFamilyInvalidated(queryClient)
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith({
      title: 'settings:mcpServers.toast.disabled[filesystem]'
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('a failed toggle reaches the global handler only: one report, one toast, nothing invalidated', async () => {
    updateMcpServerService.mockRejectedValue(new Error('cannot start it'))
    const { queryClient, api } = await mountHookOnAppClient(useToggleMcpServer)
    seedCaches(queryClient)

    await act(async () => {
      await api()
        .mutateAsync({ ...server, isActive: false })
        .catch(() => {})
    })

    expectNothingInvalidated(queryClient)
    expectSingleGlobalFailure(
      'settings:mcpServers.toast.toggleFailed',
      'cannot start it'
    )
  })
})

describe('the refresh after a save', () => {
  it('settles the mutation only once the mounted lists have re-read, so the form never closes onto a stale list', async () => {
    const refreshedServers = deferred<typeof servers>()
    getMcpServersService.mockResolvedValueOnce(servers)
    getMcpServersService.mockReturnValueOnce(refreshedServers.promise)
    getMcpToolsService.mockResolvedValue(tools)
    createMcpServerService.mockResolvedValue(server)
    const { api } = await mountHook(() => ({
      list: useMcpServers(),
      create: useCreateMcpServer()
    }))
    await act(async () => {
      await vi.waitFor(() => expect(api().list.data).toEqual(servers))
    })

    let settled = false
    await act(async () => {
      void api()
        .create.mutateAsync(draft)
        .then(() => {
          settled = true
        })
      await vi.waitFor(() =>
        expect(getMcpServersService).toHaveBeenCalledTimes(2)
      )
    })
    expect(settled).toBe(false)

    const created = [...servers, { ...server, id: 's2', name: 'github' }]
    await act(async () => {
      refreshedServers.resolve(created)
      await vi.waitFor(() => expect(settled).toBe(true))
    })
    expect(api().list.data).toEqual(created)
  })

  it('a failed re-read does not turn a successful save into a failed one', async () => {
    getMcpServersService.mockResolvedValueOnce(servers)
    getMcpServersService.mockRejectedValueOnce(new Error('list is down'))
    createMcpServerService.mockResolvedValue(server)
    const { api } = await mountHookOnAppClient(() => ({
      list: useMcpServers(),
      create: useCreateMcpServer()
    }))
    await act(async () => {
      await vi.waitFor(() => expect(api().list.data).toEqual(servers))
    })

    await act(async () => {
      await api().create.mutateAsync(draft)
    })

    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: mcpKeys.servers
    })
  })
})
