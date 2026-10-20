import type { MemoryChange, UsedMemory } from '@actovia/shared/types/memory'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'

import { i18n } from '@/lib/i18n'
import {
  getMemories,
  getMemoryUsage,
  undoMemoryChanges,
  type MemoryItem
} from '@/services/memory'

export const memoryKeys = {
  all: ['memory'] as const,
  list: ['memory', 'list'] as const,
  usage: (chatId: string) => ['memory', 'usage', chatId] as const
}

/** The memory list. `isError` + `refetch` let a page tell "the read failed"
 *  apart from "there are no memories" and offer a Retry. */
export function useMemories() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: memoryKeys.list,
    queryFn: () => getMemories(),
    // The chat's `update_memory` tool and background consolidation both
    // write memory without this page open; coming back to the window is
    // when the user would look for what changed (same reasoning as
    // devices/installed skills — see CLAUDE.md "Server state").
    refetchOnWindowFocus: true
  })
  return { data, isLoading, isError, refetch }
}

// A stable empty array: falling back to a fresh `[]` on every read would
// fail reference equality on every render and defeat the point of `select`
// below — a hook mounted for one run would re-render whenever ANY run's
// usage changed, not just its own.
const NO_USAGE: UsedMemory[] = []

/** Which memories one run of a chat used, read from the whole-chat usage
 *  record (`GET /api/v1/memory/usage?chatId=`) that the chat SSE stream
 *  also writes into live (`stream-manager.ts`'s `memories_used` handling) —
 *  narrowed here to a single run so a foot line only re-renders for its own
 *  run's data. */
export function useRunMemoryUsage(chatId: string, runId: string): UsedMemory[] {
  const { data } = useQuery({
    queryKey: memoryKeys.usage(chatId),
    queryFn: () => getMemoryUsage(chatId),
    enabled: Boolean(chatId),
    select: (usage) => usage[runId] ?? NO_USAGE
  })
  return data ?? NO_USAGE
}

/** The Memory settings page's local edits to the cached list — `set`
 *  replaces the old `setMemories(updater)`/`patchLocal` local state,
 *  `invalidate` replaces the old `load()` re-fetch after a write.
 *
 *  `beginWrite`/`settleWrite` bracket a server write this page owns
 *  (create/update/delete): call `beginWrite()` before starting it and
 *  `settleWrite()` once it settles, success or failure, in a `finally`.
 *  `settleWrite()` invalidates the list — but only once every write this
 *  page currently has in flight has settled, so two overlapping writes (a
 *  toggle, a concurrent delete) collapse into one authoritative re-read
 *  afterwards instead of each firing its own: an earlier one's invalidate
 *  landing while a later one is still uncommitted would read stale server
 *  state and revert the later write right back — the standard TanStack
 *  optimistic-update pattern (`set()`'s own `cancelQueries` guards only a
 *  read already running *when* a write applies; it can't reach a read a
 *  DIFFERENT write's own invalidate starts only afterwards). By the time
 *  every bracketed write has settled, each one's own mutation has already
 *  committed server-side, so the resulting read is authoritative for all
 *  of them at once.
 *
 *  The pending-write counter belongs to this hook instance: two components
 *  each calling `useSetMemoryList()` count separately and would each
 *  invalidate on their own. A page shares one instance — call the hook once
 *  and pass `beginWrite`/`settleWrite` down (Settings → Memory hands them to
 *  its detail view and composers). Open the bracket before an optimistic
 *  `set()`, so a write settling meanwhile cannot re-read over it. */
export function useSetMemoryList() {
  const queryClient = useQueryClient()
  const pendingWrites = useRef(0)

  const set = useCallback(
    async (updater: (list: MemoryItem[]) => MemoryItem[]) => {
      // `useMemories()` carries `refetchOnWindowFocus: true` — a read
      // already in flight (the window regaining focus while this write
      // happens) would otherwise land afterwards with the pre-write list
      // and silently revert it (a toggle flips back, a deleted row
      // reappears). Cancel it first, same guard `use-settings.ts`'s save
      // and `useRefreshDiscoverFeed` use before their own `setQueryData`.
      await queryClient.cancelQueries({ queryKey: memoryKeys.list })
      queryClient.setQueryData<MemoryItem[]>(memoryKeys.list, (old) =>
        updater(old ?? [])
      )
    },
    [queryClient]
  )
  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: memoryKeys.list }),
    [queryClient]
  )
  const beginWrite = useCallback(() => {
    pendingWrites.current += 1
  }, [])
  const settleWrite = useCallback(() => {
    pendingWrites.current = Math.max(0, pendingWrites.current - 1)
    if (pendingWrites.current === 0) invalidate()
  }, [invalidate])

  return { set, invalidate, beginWrite, settleWrite }
}

/** Marks every memory query stale — for a component that learns memory may
 *  have changed server-side without a response to say so (a run stopped
 *  while its `update_memory` call was out). */
export function useInvalidateMemory() {
  const queryClient = useQueryClient()
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: memoryKeys.all }),
    [queryClient]
  )
}

export function useUndoMemoryChanges() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (changes: MemoryChange[]) => undoMemoryChanges(changes),
    // The global mutation handler is the only error surface — a local catch
    // and toast would make one failed undo toast twice.
    meta: { errorTitle: i18n.t('chat:memoryStrip.undoFailed') },
    // Returned, not voided: whatever changed server-side (undone or
    // skipped), the memory queries this run touched are stale either way.
    onSettled: () => queryClient.invalidateQueries({ queryKey: memoryKeys.all })
  })
}
