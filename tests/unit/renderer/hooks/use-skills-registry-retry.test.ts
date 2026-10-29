// @vitest-environment happy-dom
import {
  focusManager,
  type QueryClient,
  type QueryKey
} from '@tanstack/react-query'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  advance,
  appClient,
  audit,
  curated,
  detail,
  ID,
  mountOn,
  page,
  searchResponse,
  unmountAll
} from '../../helpers/skills-registry-kit'

// This file does NOT mock '@/lib/relay-retry': it is the one that runs the
// real policy. The other two use-skills-registry files switch it off.
const getSkillsRegistryService = vi.fn()
const searchSkillsService = vi.fn()
const getSkillDetailService = vi.fn()
const getSkillAuditService = vi.fn()
const getCuratedSkillsService = vi.fn()
const getInstalledService = vi.fn()
vi.mock('@/services/skills', () => ({
  getSkillsRegistry: (...args: unknown[]) => getSkillsRegistryService(...args),
  searchSkills: (...args: unknown[]) => searchSkillsService(...args),
  getSkillDetail: (...args: unknown[]) => getSkillDetailService(...args),
  getSkillAudit: (...args: unknown[]) => getSkillAuditService(...args),
  getCuratedSkills: (...args: unknown[]) => getCuratedSkillsService(...args),
  getInstalledSkills: (...args: unknown[]) => getInstalledService(...args),
  installSkill: vi.fn(),
  uninstallSkill: vi.fn(),
  toggleSkill: vi.fn()
}))
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

const {
  skillsKeys,
  useCuratedSkills,
  useSkillAudit,
  useSkillDetail,
  useSkillsInfiniteRegistry,
  useSkillsSearch
} = await import('@/hooks/use-skills-registry')
const { installedSkillsKeys, useInstalledSkills } =
  await import('@/hooks/use-installed-skills')
const { RELAY_RETRY } = await import('@/lib/relay-retry')

interface RelayRead {
  name: string
  service: typeof getSkillsRegistryService
  value: unknown
  key: QueryKey
  exposesError: boolean
  hook: () => { data: unknown; isLoading: boolean; error?: Error | null }
}

const reads: RelayRead[] = [
  {
    name: 'the registry',
    service: getSkillsRegistryService,
    value: page(0, false),
    key: skillsKeys.registry('all-time'),
    exposesError: true,
    hook: () => useSkillsInfiniteRegistry('all-time')
  },
  {
    name: 'a search',
    service: searchSkillsService,
    value: searchResponse,
    key: skillsKeys.search('pdf'),
    exposesError: true,
    hook: () => useSkillsSearch('pdf')
  },
  {
    name: 'a detail',
    service: getSkillDetailService,
    value: detail,
    key: skillsKeys.detail(ID),
    exposesError: true,
    hook: () => useSkillDetail(ID)
  },
  {
    name: 'an audit',
    service: getSkillAuditService,
    value: audit,
    key: skillsKeys.audit(ID),
    exposesError: false,
    hook: () => useSkillAudit(ID)
  },
  {
    name: 'the curated list',
    service: getCuratedSkillsService,
    value: curated,
    key: skillsKeys.curated,
    exposesError: true,
    hook: useCuratedSkills
  }
]

// Absolute time on the fake clock, so a step reads as "at +3 s". React Query
// tells the hook through a zero-delay timer, which a fake clock runs 1 ms after
// the tick that queued it: the hook shows what happened at +7 s from +7.001 s.
function clock() {
  let now = 0
  return async (at: number) => {
    await advance(at - now)
    now = at
  }
}

const errorOf = (queryClient: QueryClient, key: QueryKey) =>
  queryClient.getQueryState(key)?.error ?? null

afterEach(async () => {
  vi.useRealTimers()
  focusManager.setFocused(undefined)
  await unmountAll()
  for (const service of [
    getSkillsRegistryService,
    searchSkillsService,
    getSkillDetailService,
    getSkillAuditService,
    getCuratedSkillsService,
    getInstalledService
  ]) {
    service.mockReset()
  }
  report.mockClear()
  toastSuccess.mockClear()
  toastError.mockClear()
})

describe('RELAY_RETRY', () => {
  it('retries three times, waiting 1 s, 2 s, then 4 s, and never more than 30 s', () => {
    expect(RELAY_RETRY.retry).toBe(3)
    expect([0, 1, 2].map((attempt) => RELAY_RETRY.retryDelay(attempt))).toEqual(
      [1_000, 2_000, 4_000]
    )
    expect(RELAY_RETRY.retryDelay(5)).toBe(30_000)
    expect(RELAY_RETRY.retryDelay(20)).toBe(30_000)
  })
})

describe.each(reads)('the relay policy on $name', (read) => {
  it('makes four requests, at +1 s, +3 s and +7 s, and never a fifth', async () => {
    vi.useFakeTimers()
    read.service.mockRejectedValue(new Error('relay is down'))
    await mountOn(await appClient(), read.hook)
    const at = clock()

    await at(0)
    expect(read.service).toHaveBeenCalledTimes(1)
    await at(999)
    expect(read.service).toHaveBeenCalledTimes(1)
    await at(1_000)
    expect(read.service).toHaveBeenCalledTimes(2)
    await at(2_999)
    expect(read.service).toHaveBeenCalledTimes(2)
    await at(3_000)
    expect(read.service).toHaveBeenCalledTimes(3)
    await at(6_999)
    expect(read.service).toHaveBeenCalledTimes(3)
    await at(7_000)
    expect(read.service).toHaveBeenCalledTimes(4)
    await at(600_000)
    expect(read.service).toHaveBeenCalledTimes(4)
  })

  it('reads as loading with no error until the last attempt fails, then reports once and never toasts', async () => {
    vi.useFakeTimers()
    read.service.mockRejectedValue(new Error('relay is down'))
    const queryClient = await appClient()
    const { api } = await mountOn(queryClient, read.hook)
    const at = clock()

    for (const during of [500, 1_500, 3_500, 6_900]) {
      await at(during)
      expect(api().isLoading).toBe(true)
      expect(api().data).toBeUndefined()
      expect(api().error ?? null).toBeNull()
      expect(errorOf(queryClient, read.key)).toBeNull()
      expect(report).not.toHaveBeenCalled()
    }

    await at(7_000)
    expect(read.service).toHaveBeenCalledTimes(4)
    expect(errorOf(queryClient, read.key)).toBeInstanceOf(Error)
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: read.key
    })

    await at(7_001)
    expect(api().isLoading).toBe(false)
    expect(api().data).toBeUndefined()
    if (read.exposesError) expect(api().error).toBeInstanceOf(Error)

    await at(600_000)
    expect(report).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('a read that recovers on its second retry lands its data and is never reported', async () => {
    vi.useFakeTimers()
    read.service
      .mockRejectedValueOnce(new Error('relay hiccup'))
      .mockRejectedValueOnce(new Error('relay hiccup'))
      .mockResolvedValue(read.value)
    const queryClient = await appClient()
    const { api } = await mountOn(queryClient, read.hook)
    const at = clock()

    await at(2_999)
    expect(read.service).toHaveBeenCalledTimes(2)
    expect(api().isLoading).toBe(true)
    expect(api().data).toBeUndefined()

    await at(3_000)
    expect(read.service).toHaveBeenCalledTimes(3)

    await at(3_001)
    expect(api().data).toBeDefined()
    expect(api().isLoading).toBe(false)
    expect(api().error ?? null).toBeNull()
    expect(errorOf(queryClient, read.key)).toBeNull()

    await at(600_000)
    expect(read.service).toHaveBeenCalledTimes(3)
    expect(report).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('stops retrying once the screen that asked for it is gone', async () => {
    vi.useFakeTimers()
    read.service.mockRejectedValue(new Error('relay is down'))
    const { api, unmount } = await mountOn(await appClient(), read.hook)
    const at = clock()

    await at(1_500)
    expect(read.service).toHaveBeenCalledTimes(2)
    expect(api().isLoading).toBe(true)
    await unmount()
    await at(600_000)

    expect(read.service).toHaveBeenCalledTimes(2)
    // The query still settles as failed once the backoff it was mid-way
    // through ends, even with no observer left to show it: pin the report so
    // a library change that swallows or duplicates it is caught.
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: read.key
    })
    expect(toastError).not.toHaveBeenCalled()
  })

  it('a retry paused while the window is blurred still reads as loading, not as the empty state, and resumes on focus', async () => {
    vi.useFakeTimers()
    read.service
      .mockRejectedValueOnce(new Error('relay hiccup'))
      .mockResolvedValue(read.value)
    const queryClient = await appClient()
    const { api } = await mountOn(queryClient, read.hook)
    const at = clock()

    await at(500)
    focusManager.setFocused(false)
    await at(1_500)

    // The backoff is over but the window is blurred: nothing is fetching.
    expect(queryClient.getQueryState(read.key)?.fetchStatus).toBe('paused')
    expect(read.service).toHaveBeenCalledTimes(1)
    for (const paused of [1_500, 60_000]) {
      await at(paused)
      expect(api().isLoading).toBe(true)
      expect(api().data).toBeUndefined()
      expect(api().error ?? null).toBeNull()
    }
    expect(report).not.toHaveBeenCalled()

    await act(async () => {
      focusManager.setFocused(true)
    })
    await at(60_010)

    expect(read.service).toHaveBeenCalledTimes(2)
    expect(api().data).toBeDefined()
    expect(api().isLoading).toBe(false)
    expect(api().error ?? null).toBeNull()
    expect(report).not.toHaveBeenCalled()
  })
})

describe('the installed skills read', () => {
  it('is local, so it keeps the app default of one quick retry: two requests, not four', async () => {
    vi.useFakeTimers()
    getInstalledService.mockRejectedValue(new Error('skills are down'))
    const queryClient = await appClient()
    await mountOn(queryClient, useInstalledSkills)
    const at = clock()

    await at(0)
    expect(getInstalledService).toHaveBeenCalledTimes(1)
    await at(499)
    expect(getInstalledService).toHaveBeenCalledTimes(1)
    await at(500)
    expect(getInstalledService).toHaveBeenCalledTimes(2)
    await at(600_000)

    expect(getInstalledService).toHaveBeenCalledTimes(2)
    expect(errorOf(queryClient, installedSkillsKeys.all)).toBeInstanceOf(Error)
    expect(report).toHaveBeenCalledTimes(1)
  })
})
