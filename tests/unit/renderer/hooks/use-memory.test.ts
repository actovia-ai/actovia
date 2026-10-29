// @vitest-environment happy-dom
import type { MemoryChange } from '@actovia/shared/types/memory'
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
  useQuery
} from '@tanstack/react-query'
import { act, createElement, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createMemory,
  deleteMemory,
  updateMemory,
  type MemoryItem
} from '@/services/memory'

const getMemoriesService = vi.fn()
const getMemoryUsageService = vi.fn()
const undoMemoryChangesService = vi.fn()
const createMemoryService = vi.fn()
const updateMemoryService = vi.fn()
const deleteMemoryService = vi.fn()
vi.mock('@/services/memory', () => ({
  getMemories: (...args: unknown[]) => getMemoriesService(...args),
  getMemoryUsage: (...args: unknown[]) => getMemoryUsageService(...args),
  undoMemoryChanges: (...args: unknown[]) => undoMemoryChangesService(...args),
  createMemory: (...args: unknown[]) => createMemoryService(...args),
  updateMemory: (...args: unknown[]) => updateMemoryService(...args),
  deleteMemory: (...args: unknown[]) => deleteMemoryService(...args)
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
  memoryKeys,
  useInvalidateMemory,
  useMemories,
  useRunMemoryUsage,
  useSetMemoryList,
  useUndoMemoryChanges
} = await import('@/hooks/use-memory')
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

// Roots a test mounted, unmounted in afterEach: a leaked root stays subscribed
// to the focus manager and would answer the window-focus test's focus events.
const mounted: Array<() => Promise<void>> = []

async function mountOn<T>(queryClient: QueryClient, hook: () => T) {
  let latest: T | undefined
  const root = createRoot(document.createElement('div'))
  const probe = createElement(Probe<T>, {
    hook,
    onReady: (value) => (latest = value)
  })
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, probe)
    )
  })
  mounted.push(async () => {
    await act(async () => {
      root.unmount()
    })
  })
  return { queryClient, api: () => latest! }
}

const isolatedClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })

const mountHook = <T>(hook: () => T) => mountOn(isolatedClient(), hook)

// The app's own client, so a failing read/write goes through the real
// `queryCache`/`mutationCache` `onError`; retries off so the failure lands
// without a backoff.
function mountHookOnAppClient<T>(hook: () => T) {
  const queryClient = createAppQueryClient()
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false }
  })
  return mountOn(queryClient, hook)
}

// Two SEPARATE roots (so neither is the other's sibling under one parent —
// only the QueryClient, not any React tree, is shared), both rendered inside
// one `act()` before either `await`s: both observers subscribe to the shared
// query synchronously, ahead of the mocked fetch's promise settling, so the
// two hooks reading the same chat's usage still dedupe into one service call.
async function mountTwoCounted<A, B>(
  queryClient: QueryClient,
  hookA: () => A,
  hookB: () => B
) {
  const onReadyA = vi.fn<(value: A) => void>()
  const onReadyB = vi.fn<(value: B) => void>()
  const rootA = createRoot(document.createElement('div'))
  const rootB = createRoot(document.createElement('div'))
  await act(async () => {
    rootA.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Probe<A>, { hook: hookA, onReady: onReadyA })
      )
    )
    rootB.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Probe<B>, { hook: hookB, onReady: onReadyB })
      )
    )
  })
  mounted.push(async () => {
    await act(async () => {
      rootA.unmount()
      rootB.unmount()
    })
  })
  return { onReadyA, onReadyB }
}

afterEach(async () => {
  // Unmount first: restoring focus while a root is still mounted fires a
  // focus refetch against an already-reset (exhausted) service mock.
  for (const unmount of mounted.splice(0)) await unmount()
  focusManager.setFocused(undefined)
  getMemoriesService.mockReset()
  getMemoryUsageService.mockReset()
  undoMemoryChangesService.mockReset()
  createMemoryService.mockReset()
  updateMemoryService.mockReset()
  deleteMemoryService.mockReset()
  report.mockClear()
  toastSuccess.mockClear()
  toastError.mockClear()
})

const memoryItem = (overrides: Partial<MemoryItem> = {}): MemoryItem => ({
  id: 'm1',
  userId: 'local',
  section: 'topic',
  key: 'Work setup',
  summary: 'Uses a mechanical keyboard',
  details: [],
  confidence: null,
  source: 'system',
  createdAt: null,
  updatedAt: null,
  lastUsedAt: null,
  isActive: true,
  ...overrides
})

const isInvalidated = (queryClient: QueryClient, key: readonly unknown[]) =>
  queryClient.getQueryState(key)?.isInvalidated

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// React Query tells its observers through a `setTimeout(0)`, so a change (or
// the absence of one) only shows a macrotask after a request settles — same
// helper as `use-discover-feed.test.ts`'s.
async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })
  })
}

function expectSingleGlobalFailure(title: string, message: string) {
  expect(report).toHaveBeenCalledTimes(1)
  expect(report).toHaveBeenCalledWith('mutation', expect.any(Error), {
    mutationKey: undefined
  })
  expect(toastError).toHaveBeenCalledTimes(1)
  expect(toastError).toHaveBeenCalledWith({ title, description: message })
  expect(toastSuccess).not.toHaveBeenCalled()
}

describe('memoryKeys', () => {
  it('has a root key, a list key and a per-chat usage key', () => {
    expect(memoryKeys.all).toEqual(['memory'])
    expect(memoryKeys.list).toEqual(['memory', 'list'])
    expect(memoryKeys.usage('chat-1')).toEqual(['memory', 'usage', 'chat-1'])
  })
})

describe('useMemories', () => {
  it('reads the memory list once through the service and caches it at memoryKeys.list', async () => {
    const items = [memoryItem()]
    getMemoriesService.mockResolvedValue(items)
    const { queryClient, api } = await mountHook(useMemories)
    expect(api().data).toBeUndefined()
    expect(api().isLoading).toBe(true)

    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(items))
    })

    expect(getMemoriesService).toHaveBeenCalledTimes(1)
    expect(getMemoriesService).toHaveBeenCalledWith()
    expect(queryClient.getQueryData(memoryKeys.list)).toEqual(items)
    expect(api().isLoading).toBe(false)
  })

  it('a failed read is reported and never toasted, and leaves the data undefined', async () => {
    getMemoriesService.mockRejectedValue(new Error('memory store is down'))
    const { api } = await mountHookOnAppClient(useMemories)

    await act(async () => {
      await vi.waitFor(() => expect(api().isLoading).toBe(false))
    })

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: memoryKeys.list
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
  })

  it('reads again when the window regains focus, so the chat/consolidation writing memory shows up, and only this read does', async () => {
    getMemoriesService
      .mockResolvedValueOnce([memoryItem()])
      .mockResolvedValueOnce([memoryItem({ id: 'm2' })])
    const other = vi.fn().mockResolvedValue('unchanged')
    const { api } = await mountHookOnAppClient(() => ({
      list: useMemories(),
      other: useQuery({ queryKey: ['not-memory'], queryFn: other })
    }))
    await act(async () => {
      await vi.waitFor(() => expect(api().list.data).toHaveLength(1))
      await vi.waitFor(() => expect(api().other.data).toBe('unchanged'))
    })

    await act(async () => {
      focusManager.setFocused(false)
    })
    expect(getMemoriesService).toHaveBeenCalledTimes(1)

    await act(async () => {
      focusManager.setFocused(true)
      await vi.waitFor(() => expect(api().list.data?.[0]?.id).toEqual('m2'))
    })

    expect(getMemoriesService).toHaveBeenCalledTimes(2)
    expect(other).toHaveBeenCalledTimes(1)
  })
})

describe('useMemories — a failed read', () => {
  it('says so (isError) and refetch() reads again, so the page can offer Retry instead of an empty list', async () => {
    getMemoriesService.mockReset()
    getMemoriesService.mockRejectedValueOnce(new Error('memory store is down'))
    const { api } = await mountHookOnAppClient(useMemories)
    await act(async () => {
      await vi.waitFor(() => expect(api().isError).toBe(true))
    })
    expect(api().data).toBeUndefined()

    getMemoriesService.mockResolvedValueOnce([memoryItem()])
    await act(async () => {
      await api().refetch()
      await vi.waitFor(() => expect(api().isError).toBe(false))
    })
    expect(api().data).toEqual([memoryItem()])
  })
})

describe('useInvalidateMemory', () => {
  it('marks every memory query stale — the list and each chat’s usage — through one stable callback', async () => {
    const { queryClient, api } = await mountHook(useInvalidateMemory)
    const first = api()
    queryClient.setQueryData(memoryKeys.list, [memoryItem()])
    queryClient.setQueryData(memoryKeys.usage('chat-1'), {})

    await act(async () => {
      await api()()
    })

    expect(isInvalidated(queryClient, memoryKeys.list)).toBe(true)
    expect(isInvalidated(queryClient, memoryKeys.usage('chat-1'))).toBe(true)
    expect(api()).toBe(first)
  })
})

describe('useRunMemoryUsage', () => {
  it('selects only the named run and returns [] when it used none', async () => {
    getMemoryUsageService.mockResolvedValue({
      'run-a': [{ id: 'm1', key: 'Work setup', section: 'topic' }]
    })
    const { api } = await mountHook(() => useRunMemoryUsage('chat-1', 'run-b'))

    await act(async () => {
      await vi.waitFor(() =>
        expect(getMemoryUsageService).toHaveBeenCalledTimes(1)
      )
    })

    expect(api()).toEqual([])
    expect(getMemoryUsageService).toHaveBeenCalledWith('chat-1')
  })

  it('returns [] before the read has resolved at all', async () => {
    getMemoryUsageService.mockReturnValue(new Promise(() => {}))
    const { api } = await mountHook(() => useRunMemoryUsage('chat-1', 'run-a'))

    expect(api()).toEqual([])
  })

  // React Query's pending → success transition is itself a legitimate
  // re-render of every observer of the query (`data` goes from `undefined`
  // to the selected value), arriving over one or more `act()`-flushed
  // microtask ticks that don't all land inside a single `act()` call. Poll
  // each side's render count until it stops moving, so "before" is captured
  // once the mount's own settle is fully done — not mid-flush.
  async function untilStable(fn: () => number, tries = 10) {
    let last = fn()
    for (let i = 0; i < tries; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      const now = fn()
      if (now === last) return now
      last = now
    }
    return last
  }

  it('a cache write for one run (what the stream manager does on `memories_used`) re-renders only the hook mounted for that run', async () => {
    getMemoryUsageService.mockResolvedValue({})
    const queryClient = isolatedClient()
    const { onReadyA, onReadyB } = await mountTwoCounted(
      queryClient,
      () => useRunMemoryUsage('chat-1', 'run-a'),
      () => useRunMemoryUsage('chat-1', 'run-b')
    )

    await untilStable(() => onReadyA.mock.calls.length)
    await untilStable(() => onReadyB.mock.calls.length)
    // Both hooks share one query (same chatId) — the service is called once,
    // not once per mounted hook.
    expect(getMemoryUsageService).toHaveBeenCalledTimes(1)
    const callsBeforeA = onReadyA.mock.calls.length
    const callsBeforeB = onReadyB.mock.calls.length
    expect(onReadyA).toHaveBeenLastCalledWith([])
    expect(onReadyB).toHaveBeenLastCalledWith([])

    await act(async () => {
      queryClient.setQueryData(
        memoryKeys.usage('chat-1'),
        (old: Record<string, unknown> | undefined) => ({
          ...old,
          'run-a': [{ id: 'm1', key: 'Work setup', section: 'topic' }]
        })
      )
    })
    await untilStable(() => onReadyA.mock.calls.length)

    expect(onReadyA.mock.calls.length).toBeGreaterThan(callsBeforeA)
    expect(onReadyA).toHaveBeenLastCalledWith([
      { id: 'm1', key: 'Work setup', section: 'topic' }
    ])
    // run-b's own slice never changed value, so its observer bails and the
    // component mounted for it never re-renders.
    expect(onReadyB.mock.calls.length).toBe(callsBeforeB)
  })
})

describe('useSetMemoryList', () => {
  it('set() applies an updater to the cached list in place, without reading through the service', async () => {
    const { queryClient, api } = await mountHook(useSetMemoryList)
    queryClient.setQueryData(memoryKeys.list, [
      memoryItem({ id: 'm1', isActive: true })
    ])

    await act(async () => {
      await api().set((list) =>
        list.map((m) => (m.id === 'm1' ? { ...m, isActive: false } : m))
      )
    })

    expect(queryClient.getQueryData(memoryKeys.list)).toEqual([
      memoryItem({ id: 'm1', isActive: false })
    ])
    expect(getMemoriesService).not.toHaveBeenCalled()
  })

  it('invalidate() marks memoryKeys.list stale without touching memoryKeys.usage', async () => {
    const { queryClient, api } = await mountHook(useSetMemoryList)
    queryClient.setQueryData(memoryKeys.list, [memoryItem()])
    queryClient.setQueryData(memoryKeys.usage('chat-1'), {})

    await act(async () => {
      await api().invalidate()
    })

    expect(isInvalidated(queryClient, memoryKeys.list)).toBe(true)
    expect(isInvalidated(queryClient, memoryKeys.usage('chat-1'))).toBe(false)
  })

  // Regression: `useMemories()` carries `refetchOnWindowFocus: true`. A
  // focus refetch already in flight when `set()` writes an optimistic
  // change (a toggle, a delete) would otherwise land afterwards with the
  // pre-write list and silently revert it — the same hazard
  // `use-settings.ts`'s save and `use-discover-feed.ts`'s
  // `useRefreshDiscoverFeed` guard against with `cancelQueries` before their
  // own `setQueryData`.
  it('a list GET already in flight when set() writes cannot overwrite it once the GET resolves', async () => {
    const before = [memoryItem({ id: 'm1', isActive: true })]
    const after = [memoryItem({ id: 'm1', isActive: false })]
    const inFlight = deferred<MemoryItem[]>()
    getMemoriesService
      .mockResolvedValueOnce(before)
      .mockReturnValueOnce(inFlight.promise)
    const { queryClient, api } = await mountHookOnAppClient(() => ({
      list: useMemories(),
      setList: useSetMemoryList()
    }))
    await act(async () => {
      await vi.waitFor(() => expect(api().list.data).toEqual(before))
    })

    // Coming back to the window starts a second read (the stale one this
    // test's write must survive) — it does not resolve yet.
    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      await vi.waitFor(() =>
        expect(getMemoriesService).toHaveBeenCalledTimes(2)
      )
    })

    // The optimistic write (what a toggle/delete does) while that GET is
    // still in flight.
    await act(async () => {
      await api().setList.set(() => after)
    })
    expect(queryClient.getQueryData(memoryKeys.list)).toEqual(after)

    // The stale GET now resolves with the pre-write list.
    await act(async () => {
      inFlight.resolve(before)
    })
    await settle()

    expect(queryClient.getQueryData(memoryKeys.list)).toEqual(after)
    expect(api().list.data).toEqual(after)
  })

  // Regression (round 3): `beginWrite`/`settleWrite` bracket a server write
  // this page owns (create/update/delete) — `settleWrite()` invalidates the
  // list, but only once every write currently in flight has settled, so two
  // overlapping writes collapse into one authoritative re-read afterwards
  // instead of each firing its own (an earlier one's invalidate landing
  // while a later one is still uncommitted would read stale server state
  // and revert the later write right back).
  describe('beginWrite / settleWrite', () => {
    it('settleWrite() after a single beginWrite() invalidates the list', async () => {
      const { queryClient, api } = await mountHook(useSetMemoryList)
      queryClient.setQueryData(memoryKeys.list, [memoryItem()])

      act(() => {
        api().beginWrite()
      })
      expect(isInvalidated(queryClient, memoryKeys.list)).toBe(false)
      await act(async () => {
        api().settleWrite()
      })

      expect(isInvalidated(queryClient, memoryKeys.list)).toBe(true)
    })

    it('two overlapping writes invalidate once, only once both have settled', async () => {
      getMemoriesService.mockResolvedValue([memoryItem()])
      const { api } = await mountHookOnAppClient(() => ({
        list: useMemories(),
        setList: useSetMemoryList()
      }))
      await act(async () => {
        await vi.waitFor(() => expect(api().list.data).toBeDefined())
      })
      getMemoriesService.mockClear()

      act(() => {
        api().setList.beginWrite() // the toggle
        api().setList.beginWrite() // the concurrent delete
      })
      await act(async () => {
        api().setList.settleWrite() // the toggle's own PATCH settles first
      })
      // Not yet — the delete is still in flight, so this settle must not
      // fire its own invalidate.
      expect(getMemoriesService).not.toHaveBeenCalled()

      await act(async () => {
        api().setList.settleWrite() // the delete's own DELETE settles
      })
      expect(getMemoriesService).toHaveBeenCalledTimes(1)
    })

    it('never goes negative — an extra settleWrite() past zero still invalidates, once', async () => {
      getMemoriesService.mockResolvedValue([memoryItem()])
      const { api } = await mountHookOnAppClient(() => ({
        list: useMemories(),
        setList: useSetMemoryList()
      }))
      await act(async () => {
        await vi.waitFor(() => expect(api().list.data).toBeDefined())
      })
      getMemoriesService.mockClear()

      await act(async () => {
        api().setList.settleWrite()
      })
      expect(getMemoriesService).toHaveBeenCalledTimes(1)
      getMemoriesService.mockClear()

      act(() => {
        api().setList.beginWrite()
      })
      await act(async () => {
        api().setList.settleWrite()
      })
      expect(getMemoriesService).toHaveBeenCalledTimes(1)
    })
  })
})

// A minimal stand-in for `settings-form/memory.tsx`'s relevant logic (list +
// selection + handleNew/handleToggle/handleDelete + the "not found → clear
// selection" effect), used to prove the hook primitives compose correctly
// end to end without needing that component's `UseFormReturnType` prop.
// Mirrors the real handlers' exact sequence — see `memory.tsx`.
function useMemoryPageHarness() {
  const { data, isLoading } = useMemories()
  const memories = data ?? []
  const { set, beginWrite, settleWrite } = useSetMemoryList()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = useMemo(
    () => memories.find((m) => m.id === selectedId) ?? null,
    [memories, selectedId]
  )
  useEffect(() => {
    if (selectedId && !isLoading && !selected) setSelectedId(null)
  }, [selectedId, selected, isLoading])

  const handleNew = async () => {
    beginWrite()
    try {
      const row = await createMemory({
        section: 'topic',
        key: 'New memory',
        summary: '',
        details: [],
        source: 'explicit'
      })
      await set((ms) => (ms.some((m) => m.id === row.id) ? ms : [...ms, row]))
      setSelectedId(row.id)
    } finally {
      settleWrite()
    }
  }

  const handleToggle = async (item: MemoryItem) => {
    await set((ms) =>
      ms.map((m) =>
        m.id === item.id ? { ...m, isActive: item.isActive === false } : m
      )
    )
    beginWrite()
    try {
      await updateMemory(item.id, { isActive: item.isActive === false })
    } catch {
      // Silent — matches `memory.tsx`'s `handleToggle`.
    } finally {
      settleWrite()
    }
  }

  const handleDelete = async (item: MemoryItem) => {
    await set((ms) => ms.filter((m) => m.id !== item.id))
    beginWrite()
    try {
      await deleteMemory(item.id, true)
    } catch {
      // Silent — matches `memory.tsx`'s `handleDelete`.
    } finally {
      settleWrite()
    }
  }

  return {
    memories,
    selectedId,
    selected,
    isLoading,
    handleNew,
    handleToggle,
    handleDelete
  }
}

describe('a memory.tsx-style consumer — regression round 3 (findings a & b)', () => {
  it('(i) create, then toggle another row while the post-create invalidate is in flight: the new row is in the list AND the selection is the new row', async () => {
    const A = memoryItem({ id: 'A', key: 'A' })
    const B = memoryItem({ id: 'B', key: 'B', isActive: true })
    const C = memoryItem({ id: 'C', key: 'New memory', summary: '' })
    const finalList = [A, { ...B, isActive: false }, C]
    const postCreateGet = deferred<MemoryItem[]>()
    getMemoriesService
      .mockResolvedValueOnce([A, B]) // initial mount load
      .mockReturnValueOnce(postCreateGet.promise) // handleNew's own settle-invalidate
      .mockResolvedValueOnce(finalList) // handleToggle's own settle-invalidate
    createMemoryService.mockResolvedValue(C)
    updateMemoryService.mockResolvedValue()

    const { queryClient, api } =
      await mountHookOnAppClient(useMemoryPageHarness)
    await act(async () => {
      await vi.waitFor(() => expect(api().memories).toEqual([A, B]))
    })

    await act(async () => {
      await api().handleNew()
    })
    // handleNew's own follow-up invalidate is fire-and-forget — wait for it
    // to have started (still unresolved: `postCreateGet` hasn't settled).
    await act(async () => {
      await vi.waitFor(() =>
        expect(getMemoriesService).toHaveBeenCalledTimes(2)
      )
    })

    // The core of finding (a): the selection and the new row are both in
    // place immediately — neither waited on that still-unresolved invalidate
    // to land.
    expect(api().selectedId).toBe(C.id)
    expect(api().selected?.id).toBe(C.id)
    expect(queryClient.getQueryData<MemoryItem[]>(memoryKeys.list)).toEqual([
      A,
      B,
      C
    ])

    // Toggle B while that invalidate's GET is still in flight — `set()`
    // cancels it (round 1) and applies on top of the current cache, which
    // already has C.
    await act(async () => {
      await api().handleToggle(B)
    })
    await act(async () => {
      await vi.waitFor(() =>
        expect(getMemoriesService).toHaveBeenCalledTimes(3)
      )
    })
    await settle()

    // The toggle's own settle-invalidate (started only after its own PATCH
    // committed) is authoritative for both changes at once.
    expect(queryClient.getQueryData<MemoryItem[]>(memoryKeys.list)).toEqual(
      finalList
    )
    expect(api().memories).toEqual(finalList)
    // The selection never moved — the not-found effect never fired.
    expect(api().selectedId).toBe(C.id)
    expect(api().selected?.id).toBe(C.id)

    // Whatever the cancelled post-create GET would have resolved to lands
    // too late to matter — round 1's guarantee, still intact.
    await act(async () => {
      postCreateGet.resolve([A, B])
    })
    await settle()
    expect(queryClient.getQueryData<MemoryItem[]>(memoryKeys.list)).toEqual(
      finalList
    )
  })

  it('(ii) a read in flight when a delete happens: the stale GET (still listing the deleted row) resolves afterwards, but the row stays gone', async () => {
    const X = memoryItem({ id: 'X', key: 'X' })
    const Y = memoryItem({ id: 'Y', key: 'Y' })
    const staleRead = deferred<MemoryItem[]>()
    getMemoriesService
      .mockResolvedValueOnce([X, Y]) // initial mount load
      .mockReturnValueOnce(staleRead.promise) // some other read — in flight
      .mockResolvedValueOnce([Y]) // handleDelete's own settle-invalidate
    deleteMemoryService.mockResolvedValue()

    const { queryClient, api } =
      await mountHookOnAppClient(useMemoryPageHarness)
    await act(async () => {
      await vi.waitFor(() => expect(api().memories).toEqual([X, Y]))
    })

    // A read is already in flight (e.g. a focus refetch, the chat stream's
    // invalidate after `update_memory`, undo's `onSettled`, the composer's
    // `onApplied`) — not yet resolved.
    act(() => {
      void queryClient.invalidateQueries({ queryKey: memoryKeys.list })
    })
    await act(async () => {
      await vi.waitFor(() =>
        expect(getMemoriesService).toHaveBeenCalledTimes(2)
      )
    })

    // Delete X while that read is still in flight — cancels it, removes X
    // locally, and (once its own DELETE has committed) invalidates for real.
    await act(async () => {
      await api().handleDelete(X)
    })
    await act(async () => {
      await vi.waitFor(() =>
        expect(getMemoriesService).toHaveBeenCalledTimes(3)
      )
    })
    await settle()
    expect(queryClient.getQueryData<MemoryItem[]>(memoryKeys.list)).toEqual([Y])

    // The stale read (started before the delete) resolves afterwards, still
    // listing X — round 1's guarantee, and (round 2 reverted) no recovery
    // mechanism left to resurrect a locally deleted row from it either.
    await act(async () => {
      staleRead.resolve([X, Y])
    })
    await settle()
    expect(queryClient.getQueryData<MemoryItem[]>(memoryKeys.list)).toEqual([Y])
    expect(api().memories).toEqual([Y])
  })
})

describe('useUndoMemoryChanges', () => {
  const changes: MemoryChange[] = [
    {
      op: 'update',
      id: 'm1',
      before: {
        section: 'topic',
        key: 'Work setup',
        summary: 'old summary',
        details: [],
        isActive: true
      },
      after: {
        section: 'topic',
        key: 'Work setup',
        summary: 'new summary',
        details: [],
        isActive: true
      }
    }
  ]

  it('undoes by the exact changes array and invalidates memoryKeys.all on settle', async () => {
    undoMemoryChangesService.mockResolvedValue({
      undone: ['m1'],
      skipped: []
    })
    const { queryClient, api } = await mountHook(useUndoMemoryChanges)
    queryClient.setQueryData(memoryKeys.list, [memoryItem()])
    queryClient.setQueryData(memoryKeys.usage('chat-1'), {})

    let result: { undone: string[]; skipped: string[] } | undefined
    await act(async () => {
      result = await api().mutateAsync(changes)
    })

    expect(undoMemoryChangesService).toHaveBeenCalledTimes(1)
    expect(undoMemoryChangesService).toHaveBeenCalledWith(changes)
    expect(result).toEqual({ undone: ['m1'], skipped: [] })
    expect(isInvalidated(queryClient, memoryKeys.list)).toBe(true)
    expect(isInvalidated(queryClient, memoryKeys.usage('chat-1'))).toBe(true)
  })

  it('a failed undo reaches the global handler only — one report, one toast titled chat:memoryStrip.undoFailed — and still invalidates on settle', async () => {
    undoMemoryChangesService.mockRejectedValue(new Error('entry changed since'))
    const { queryClient, api } =
      await mountHookOnAppClient(useUndoMemoryChanges)
    queryClient.setQueryData(memoryKeys.list, [memoryItem()])

    await act(async () => {
      await api()
        .mutateAsync(changes)
        .catch(() => {})
    })

    expectSingleGlobalFailure(
      'chat:memoryStrip.undoFailed',
      'entry changed since'
    )
    expect(isInvalidated(queryClient, memoryKeys.list)).toBe(true)
  })
})
