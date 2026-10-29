// @vitest-environment happy-dom
import type {
  SkillListResponse,
  SkillsView
} from '@actovia/shared/types/skills'
import { act, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  advance,
  deferred,
  ID,
  item,
  mountHook,
  mountHookOnAppClient,
  mountOn,
  page,
  plainClient,
  unmountAll
} from '../../helpers/skills-registry-kit'

const getSkillsRegistryService = vi.fn()
vi.mock('@/services/skills', () => ({
  getSkillsRegistry: (...args: unknown[]) => getSkillsRegistryService(...args),
  searchSkills: vi.fn(),
  getSkillDetail: vi.fn(),
  getSkillAudit: vi.fn(),
  getCuratedSkills: vi.fn()
}))
// The relay's own retry policy is exercised in use-skills-registry-retry.test.ts;
// here a failing read must land without a backoff.
vi.mock('@/lib/relay-retry', () => ({ RELAY_RETRY: { retry: false } }))
vi.mock('@/lib/i18n', () => ({ i18n: { t: (key: string) => key } }))
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

const { skillsKeys, useSkillsInfiniteRegistry } =
  await import('@/hooks/use-skills-registry')

afterEach(async () => {
  vi.useRealTimers()
  await unmountAll()
  getSkillsRegistryService.mockReset()
  report.mockClear()
  toastSuccess.mockClear()
  toastError.mockClear()
})

describe('skillsKeys', () => {
  it('nests every read under one skills root, distinct per view, query and id', () => {
    expect(skillsKeys.registry('all-time')).toEqual([
      'skills',
      'registry',
      'all-time'
    ])
    expect(skillsKeys.registry('trending')).toEqual([
      'skills',
      'registry',
      'trending'
    ])
    expect(skillsKeys.registry('hot')).not.toEqual(
      skillsKeys.registry('trending')
    )
    expect(skillsKeys.search('pdf')).toEqual(['skills', 'search', 'pdf'])
    expect(skillsKeys.search('pdf')).not.toEqual(skillsKeys.search('sql'))
    expect(skillsKeys.detail(ID)).toEqual(['skills', 'detail', ID])
    expect(skillsKeys.audit(ID)).toEqual(['skills', 'audit', ID])
    expect(skillsKeys.detail(ID)).not.toEqual(skillsKeys.audit(ID))
    expect(skillsKeys.curated).toEqual(['skills', 'curated'])
  })
})

describe('useSkillsInfiniteRegistry', () => {
  it('reads page 0 only on the first render, caches it, and has the total in pages[0]', async () => {
    const first = deferred<SkillListResponse>()
    getSkillsRegistryService.mockReturnValue(first.promise)
    const { queryClient, api } = await mountHook(() =>
      useSkillsInfiniteRegistry('all-time')
    )
    expect(api().isLoading).toBe(true)
    expect(api().data).toBeUndefined()

    await act(async () => {
      first.resolve(page(0, true, 57))
      await vi.waitFor(() => expect(api().data?.pages).toHaveLength(1))
    })

    expect(getSkillsRegistryService).toHaveBeenCalledTimes(1)
    expect(getSkillsRegistryService).toHaveBeenCalledWith('all-time', 0)
    expect(api().isLoading).toBe(false)
    expect(api().data?.pages[0]?.pagination.total).toBe(57)
    expect(api().hasNextPage).toBe(true)
    expect(queryClient.getQueryData(skillsKeys.registry('all-time'))).toEqual({
      pages: [page(0, true, 57)],
      pageParams: [0]
    })
  })

  it('fetchNextPage asks for page 1 and does not read page 0 again, until a page says there is no more', async () => {
    getSkillsRegistryService.mockImplementation(
      (_view: SkillsView, index: number) =>
        Promise.resolve(page(index, index < 2))
    )
    const { api } = await mountHook(() => useSkillsInfiniteRegistry('trending'))
    await act(async () => {
      await vi.waitFor(() => expect(api().data?.pages).toHaveLength(1))
    })

    await act(async () => {
      await api().fetchNextPage()
      await vi.waitFor(() => expect(api().data?.pages).toHaveLength(2))
    })

    expect(getSkillsRegistryService.mock.calls).toEqual([
      ['trending', 0],
      ['trending', 1]
    ])
    expect(api().data?.pages.map((p) => p.pagination.page)).toEqual([0, 1])
    expect(api().hasNextPage).toBe(true)

    await act(async () => {
      await api().fetchNextPage()
      await vi.waitFor(() => expect(api().data?.pages).toHaveLength(3))
    })

    expect(getSkillsRegistryService.mock.calls).toEqual([
      ['trending', 0],
      ['trending', 1],
      ['trending', 2]
    ])
    expect(api().hasNextPage).toBe(false)

    await act(async () => {
      await api().fetchNextPage()
    })
    expect(getSkillsRegistryService).toHaveBeenCalledTimes(3)
  })

  it('has no next page when the first one says hasMore is false', async () => {
    getSkillsRegistryService.mockResolvedValue(page(0, false, 3))
    const { api } = await mountHook(() => useSkillsInfiniteRegistry('hot'))

    await act(async () => {
      await vi.waitFor(() => expect(api().data?.pages).toHaveLength(1))
    })

    expect(api().hasNextPage).toBe(false)
  })

  it('is loading-more, not loading, while a next page is on its way, and keeps the pages it has', async () => {
    const second = deferred<SkillListResponse>()
    getSkillsRegistryService
      .mockResolvedValueOnce(page(0, true))
      .mockReturnValueOnce(second.promise)
    const { api } = await mountHook(() => useSkillsInfiniteRegistry('all-time'))
    await act(async () => {
      await vi.waitFor(() => expect(api().data?.pages).toHaveLength(1))
    })
    expect(api().isFetchingNextPage).toBe(false)

    await act(async () => {
      void api().fetchNextPage()
      await vi.waitFor(() => expect(api().isFetchingNextPage).toBe(true))
    })

    expect(api().isLoading).toBe(false)
    expect(api().data?.pages).toHaveLength(1)

    await act(async () => {
      second.resolve(page(1, false))
      await vi.waitFor(() => expect(api().data?.pages).toHaveLength(2))
    })
    expect(api().isFetchingNextPage).toBe(false)
    expect(api().hasNextPage).toBe(false)
  })

  it('keeps each view in a cache of its own', async () => {
    const ofView = (view: SkillsView) => ({
      ...page(0, false),
      data: [{ ...item(0), id: `${view}/repo/skill` }]
    })
    const trending = deferred<SkillListResponse>()
    getSkillsRegistryService
      .mockResolvedValueOnce(ofView('all-time'))
      .mockReturnValueOnce(trending.promise)
    const { api, queryClient } = await mountHook(() => {
      const [view, setView] = useState<SkillsView>('all-time')
      return { ...useSkillsInfiniteRegistry(view), setView }
    })
    await act(async () => {
      await vi.waitFor(() =>
        expect(api().data?.pages[0]?.data[0]?.id).toBe('all-time/repo/skill')
      )
    })

    await act(async () => {
      api().setView('trending')
    })

    expect(getSkillsRegistryService).toHaveBeenLastCalledWith('trending', 0)
    expect(api().data).toBeUndefined()
    expect(api().isLoading).toBe(true)
    await act(async () => {
      trending.resolve(ofView('trending'))
      await vi.waitFor(() =>
        expect(api().data?.pages[0]?.data[0]?.id).toBe('trending/repo/skill')
      )
    })
    expect(
      queryClient.getQueryData<{ pages: SkillListResponse[] }>(
        skillsKeys.registry('all-time')
      )?.pages[0]?.data[0]?.id
    ).toBe('all-time/repo/skill')
  })

  it('shares one request between the tab total and the leaderboard reading the same view', async () => {
    getSkillsRegistryService.mockResolvedValue(page(0, true, 57))
    const { api } = await mountHook(() => ({
      tab: useSkillsInfiniteRegistry('all-time'),
      board: useSkillsInfiniteRegistry('all-time')
    }))

    await act(async () => {
      await vi.waitFor(() => expect(api().board.data?.pages).toHaveLength(1))
    })

    expect(getSkillsRegistryService).toHaveBeenCalledTimes(1)
    expect(getSkillsRegistryService).toHaveBeenCalledWith('all-time', 0)
    expect(api().tab.data?.pages[0]?.pagination.total).toBe(57)
    expect(api().board.data).toBe(api().tab.data)
  })

  it('a failed load-more is reported, keeps the pages already read, and a second try reads the same page', async () => {
    getSkillsRegistryService
      .mockResolvedValueOnce(page(0, true))
      .mockRejectedValueOnce(new Error('relay hiccup'))
      .mockResolvedValueOnce(page(1, false))
    const { api } = await mountHookOnAppClient(() =>
      useSkillsInfiniteRegistry('all-time')
    )
    await act(async () => {
      await vi.waitFor(() => expect(api().data?.pages).toHaveLength(1))
    })

    await act(async () => {
      await api().fetchNextPage()
      await vi.waitFor(() => expect(api().error).toBeInstanceOf(Error))
    })

    expect(api().data?.pages).toHaveLength(1)
    expect(api().hasNextPage).toBe(true)
    expect(api().isFetchingNextPage).toBe(false)
    expect(report).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()

    await act(async () => {
      await api().fetchNextPage()
      await vi.waitFor(() => expect(api().data?.pages).toHaveLength(2))
    })

    expect(getSkillsRegistryService.mock.calls).toEqual([
      ['all-time', 0],
      ['all-time', 1],
      ['all-time', 1]
    ])
    expect(api().error).toBeNull()
  })

  it('once stale, a remount re-reads every page it holds, one after the other, first page first', async () => {
    vi.useFakeTimers()
    getSkillsRegistryService.mockImplementation(
      (_view: SkillsView, index: number) => Promise.resolve(page(index, true))
    )
    const queryClient = plainClient()
    const view = () => useSkillsInfiniteRegistry('all-time')
    // The tab total stays mounted for as long as the market is open: it is
    // what keeps the query alive past its gc time while the leaderboard leaves.
    const tab = await mountOn(queryClient, view)
    const board = await mountOn(queryClient, view)
    await advance(0)
    await act(async () => {
      await board.api().fetchNextPage()
    })
    await advance(0)
    expect(board.api().data?.pages).toHaveLength(2)
    expect(getSkillsRegistryService.mock.calls).toEqual([
      ['all-time', 0],
      ['all-time', 1]
    ])
    await board.unmount()
    await advance(5 * 60_000)
    expect(tab.api().data?.pages).toHaveLength(2)

    const page0 = deferred<SkillListResponse>()
    getSkillsRegistryService.mockReset()
    getSkillsRegistryService
      .mockReturnValueOnce(page0.promise)
      .mockResolvedValueOnce(page(1, true))
    const again = await mountOn(queryClient, view)
    await advance(0)

    // Page 1 waits for page 0: its param comes out of page 0's answer.
    expect(getSkillsRegistryService.mock.calls).toEqual([['all-time', 0]])
    page0.resolve(page(0, true))
    await advance(0)

    expect(getSkillsRegistryService.mock.calls).toEqual([
      ['all-time', 0],
      ['all-time', 1]
    ])
    expect(again.api().data?.pages).toHaveLength(2)
  })

  it('exposes only what the components read', async () => {
    getSkillsRegistryService.mockResolvedValue(page(0, false))
    const { api } = await mountHook(() => useSkillsInfiniteRegistry('all-time'))

    expect(Object.keys(api()).sort()).toEqual(
      [
        'data',
        'error',
        'fetchNextPage',
        'hasNextPage',
        'isFetchingNextPage',
        'isLoading',
        'refetch'
      ].sort()
    )
  })
})
