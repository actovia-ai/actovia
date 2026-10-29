// @vitest-environment happy-dom
import type {
  SkillAuditResponse,
  SkillCuratedResponse,
  SkillDetail,
  SkillSearchResponse
} from '@actovia/shared/types/skills'
import type { QueryKey } from '@tanstack/react-query'
import { act, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  advance,
  audit,
  curated,
  deferred,
  detail,
  ID,
  mountHook,
  mountHookOnAppClient,
  mountOn,
  page,
  plainClient,
  searchResponse,
  unmountAll
} from '../../helpers/skills-registry-kit'

const getSkillsRegistryService = vi.fn()
const searchSkillsService = vi.fn()
const getSkillDetailService = vi.fn()
const getSkillAuditService = vi.fn()
const getCuratedSkillsService = vi.fn()
vi.mock('@/services/skills', () => ({
  getSkillsRegistry: (...args: unknown[]) => getSkillsRegistryService(...args),
  searchSkills: (...args: unknown[]) => searchSkillsService(...args),
  getSkillDetail: (...args: unknown[]) => getSkillDetailService(...args),
  getSkillAudit: (...args: unknown[]) => getSkillAuditService(...args),
  getCuratedSkills: (...args: unknown[]) => getCuratedSkillsService(...args)
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

const {
  skillsKeys,
  useCuratedSkills,
  useSkillAudit,
  useSkillDetail,
  useSkillsInfiniteRegistry,
  useSkillsSearch
} = await import('@/hooks/use-skills-registry')

interface Read {
  name: string
  service: typeof getSkillsRegistryService
  value: unknown
  key: QueryKey
  staleMs: number
  hook: () => { data: unknown; isLoading: boolean }
}

interface RetryableRead extends Omit<Read, 'hook'> {
  hook: () => {
    data: unknown
    isLoading: boolean
    error: Error | null
    refetch: () => Promise<unknown>
  }
}

const FIVE_MIN = 5 * 60_000
const TEN_MIN = 10 * 60_000

// The four reads a component shows a "load failed" state and a retry for.
const retryableReads: RetryableRead[] = [
  {
    name: 'the registry',
    service: getSkillsRegistryService,
    value: page(0, false),
    key: skillsKeys.registry('all-time'),
    staleMs: FIVE_MIN,
    hook: () => useSkillsInfiniteRegistry('all-time')
  },
  {
    name: 'a search',
    service: searchSkillsService,
    value: searchResponse,
    key: skillsKeys.search('pdf'),
    staleMs: FIVE_MIN,
    hook: () => useSkillsSearch('pdf')
  },
  {
    name: 'a detail',
    service: getSkillDetailService,
    value: detail,
    key: skillsKeys.detail(ID),
    staleMs: FIVE_MIN,
    hook: () => useSkillDetail(ID)
  },
  {
    name: 'the curated list',
    service: getCuratedSkillsService,
    value: curated,
    key: skillsKeys.curated,
    staleMs: TEN_MIN,
    hook: useCuratedSkills
  }
]

const auditRead: Read = {
  name: 'an audit',
  service: getSkillAuditService,
  value: audit,
  key: skillsKeys.audit(ID),
  staleMs: FIVE_MIN,
  hook: () => useSkillAudit(ID)
}

const reads: Read[] = [...retryableReads, auditRead]

afterEach(async () => {
  vi.useRealTimers()
  await unmountAll()
  getSkillsRegistryService.mockReset()
  searchSkillsService.mockReset()
  getSkillDetailService.mockReset()
  getSkillAuditService.mockReset()
  getCuratedSkillsService.mockReset()
  report.mockClear()
  toastSuccess.mockClear()
  toastError.mockClear()
})

describe('useSkillsSearch', () => {
  it('makes no request, and is not loading, for an empty query, and starts once there is one', async () => {
    const results = deferred<SkillSearchResponse>()
    searchSkillsService.mockReturnValue(results.promise)
    const { api, queryClient } = await mountHook(() => {
      const [query, setQuery] = useState('')
      return { ...useSkillsSearch(query), setQuery }
    })

    expect(searchSkillsService).not.toHaveBeenCalled()
    expect(api().isLoading).toBe(false)
    expect(api().data).toBeUndefined()

    await act(async () => {
      api().setQuery('pdf')
    })
    expect(api().isLoading).toBe(true)
    await act(async () => {
      results.resolve(searchResponse)
      await vi.waitFor(() => expect(api().data).toEqual(searchResponse))
    })

    expect(searchSkillsService).toHaveBeenCalledTimes(1)
    expect(searchSkillsService).toHaveBeenCalledWith('pdf')
    expect(queryClient.getQueryData(skillsKeys.search('pdf'))).toEqual(
      searchResponse
    )
  })

  it('hands the query to the service as typed, which encodes it for the URL', async () => {
    searchSkillsService.mockResolvedValue(searchResponse)
    const { api } = await mountHook(() => useSkillsSearch('a&b=c d'))

    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(searchResponse))
    })

    expect(searchSkillsService).toHaveBeenCalledWith('a&b=c d')
  })

  it('a changed query is a new key: it reads as loading until it lands, and the old one stays cached', async () => {
    const second = deferred<SkillSearchResponse>()
    searchSkillsService
      .mockResolvedValueOnce(searchResponse)
      .mockReturnValueOnce(second.promise)
    const { api, queryClient } = await mountHook(() => {
      const [query, setQuery] = useState('pdf')
      return { ...useSkillsSearch(query), setQuery }
    })
    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(searchResponse))
    })

    await act(async () => {
      api().setQuery('sql')
    })

    expect(searchSkillsService).toHaveBeenLastCalledWith('sql')
    expect(api().data).toBeUndefined()
    expect(api().isLoading).toBe(true)

    const sqlResults = { ...searchResponse, query: 'sql' }
    await act(async () => {
      second.resolve(sqlResults)
      await vi.waitFor(() => expect(api().data).toEqual(sqlResults))
    })
    expect(queryClient.getQueryData(skillsKeys.search('pdf'))).toEqual(
      searchResponse
    )
    expect(queryClient.getQueryData(skillsKeys.search('sql'))).toEqual(
      sqlResults
    )
  })
})

describe('useSkillDetail', () => {
  it('reads the detail of an id and caches it under that id', async () => {
    const pending = deferred<SkillDetail>()
    getSkillDetailService.mockReturnValue(pending.promise)
    const { api, queryClient } = await mountHook(() => useSkillDetail(ID))
    expect(api().isLoading).toBe(true)

    await act(async () => {
      pending.resolve(detail)
      await vi.waitFor(() => expect(api().data).toEqual(detail))
    })

    expect(getSkillDetailService).toHaveBeenCalledTimes(1)
    expect(getSkillDetailService).toHaveBeenCalledWith(ID)
    expect(api().isLoading).toBe(false)
    expect(queryClient.getQueryData(skillsKeys.detail(ID))).toEqual(detail)
    expect(getSkillAuditService).not.toHaveBeenCalled()
  })

  it('a different id is a different read', async () => {
    const other = deferred<SkillDetail>()
    getSkillDetailService
      .mockResolvedValueOnce(detail)
      .mockReturnValueOnce(other.promise)
    const { api, queryClient } = await mountHook(() => {
      const [id, setId] = useState(ID)
      return { ...useSkillDetail(id), setId }
    })
    await act(async () => {
      await vi.waitFor(() => expect(api().data?.id).toBe(ID))
    })

    await act(async () => {
      api().setId('other/repo/skill')
    })
    expect(getSkillDetailService).toHaveBeenLastCalledWith('other/repo/skill')
    expect(api().data).toBeUndefined()
    await act(async () => {
      other.resolve({ ...detail, id: 'other/repo/skill' })
      await vi.waitFor(() => expect(api().data?.id).toBe('other/repo/skill'))
    })

    expect(getSkillDetailService).toHaveBeenCalledTimes(2)
    expect(queryClient.getQueryData(skillsKeys.detail(ID))).toEqual(detail)
  })
})

describe('useSkillAudit', () => {
  it('reads the audit of an id and caches it under that id', async () => {
    const pending = deferred<SkillAuditResponse>()
    getSkillAuditService.mockReturnValue(pending.promise)
    const { api, queryClient } = await mountHook(() => useSkillAudit(ID))
    expect(api().isLoading).toBe(true)

    await act(async () => {
      pending.resolve(audit)
      await vi.waitFor(() => expect(api().data).toEqual(audit))
    })

    expect(getSkillAuditService).toHaveBeenCalledTimes(1)
    expect(getSkillAuditService).toHaveBeenCalledWith(ID)
    expect(queryClient.getQueryData(skillsKeys.audit(ID))).toEqual(audit)
    expect(getSkillDetailService).not.toHaveBeenCalled()
  })

  it('tolerates null for an unaudited skill: a settled success, not an error and not undefined', async () => {
    getSkillAuditService.mockResolvedValue(null)
    const { api, queryClient } = await mountHookOnAppClient(() =>
      useSkillAudit(ID)
    )

    await act(async () => {
      await vi.waitFor(() => expect(api().isLoading).toBe(false))
    })

    expect(api().data).toBeNull()
    expect(queryClient.getQueryData(skillsKeys.audit(ID))).toBeNull()
    expect(queryClient.getQueryState(skillsKeys.audit(ID))?.status).toBe(
      'success'
    )
    expect(report).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('exposes only what the panel reads', async () => {
    getSkillAuditService.mockResolvedValue(audit)
    const { api } = await mountHook(() => useSkillAudit(ID))

    expect(Object.keys(api()).sort()).toEqual(['data', 'isLoading'])
  })
})

describe('useCuratedSkills', () => {
  it('reads the curated list once, with no parameters, and caches it', async () => {
    const pending = deferred<SkillCuratedResponse>()
    getCuratedSkillsService.mockReturnValue(pending.promise)
    const { api, queryClient } = await mountHook(useCuratedSkills)
    expect(api().isLoading).toBe(true)

    await act(async () => {
      pending.resolve(curated)
      await vi.waitFor(() => expect(api().data).toEqual(curated))
    })

    expect(getCuratedSkillsService).toHaveBeenCalledTimes(1)
    expect(getCuratedSkillsService).toHaveBeenCalledWith()
    expect(queryClient.getQueryData(skillsKeys.curated)).toEqual(curated)
  })

  it('keeps the list for ten minutes after the tab is left, so coming back does not download it again', async () => {
    vi.useFakeTimers()
    getCuratedSkillsService.mockResolvedValue(curated)
    const queryClient = plainClient()
    const first = await mountOn(queryClient, useCuratedSkills)
    await advance(0)
    expect(first.api().data).toEqual(curated)
    await first.unmount()

    await advance(TEN_MIN - FIVE_MIN + 1_000)
    const second = await mountOn(queryClient, useCuratedSkills)
    await advance(0)

    // Past the default five minutes both for staleness and for garbage collection.
    expect(second.api().data).toEqual(curated)
    expect(second.api().isLoading).toBe(false)
    expect(getCuratedSkillsService).toHaveBeenCalledTimes(1)
  })
})

describe.each(reads)('reading $name', (read) => {
  it(`is not read again for a mount within ${read.staleMs / 60_000} minutes, and is from then on`, async () => {
    vi.useFakeTimers()
    read.service.mockResolvedValue(read.value)
    const queryClient = plainClient()
    const first = await mountOn(queryClient, read.hook)
    await advance(0)
    expect(read.service).toHaveBeenCalledTimes(1)
    expect(first.api().data).toBeDefined()
    await first.unmount()

    await advance(read.staleMs - 1)
    const second = await mountOn(queryClient, read.hook)
    await advance(0)
    expect(read.service).toHaveBeenCalledTimes(1)
    expect(second.api().data).toBeDefined()
    expect(second.api().isLoading).toBe(false)
    await second.unmount()

    await advance(1)
    await mountOn(queryClient, read.hook)
    await advance(0)
    expect(read.service).toHaveBeenCalledTimes(2)
  })

  it('a failed read is reported once and never toasted, and leaves the data undefined', async () => {
    read.service.mockRejectedValue(new Error('relay is down'))
    const { api } = await mountHookOnAppClient(read.hook)

    await act(async () => {
      await vi.waitFor(() => expect(api().isLoading).toBe(false))
    })

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: read.key
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
  })
})

describe.each(retryableReads)('the failure of $name', (read) => {
  it('is exposed as error, and refetch reads again and clears it', async () => {
    read.service
      .mockRejectedValueOnce(new Error('relay is down'))
      .mockResolvedValueOnce(read.value)
    const { api } = await mountHookOnAppClient(read.hook)
    await act(async () => {
      await vi.waitFor(() => expect(api().isLoading).toBe(false))
    })
    expect(api().error).toBeInstanceOf(Error)
    expect(api().data).toBeUndefined()

    await act(async () => {
      await api().refetch()
      await vi.waitFor(() => expect(api().data).toBeDefined())
    })

    expect(read.service).toHaveBeenCalledTimes(2)
    expect(api().error).toBeNull()
    expect(api().isLoading).toBe(false)
  })

  it('reads as loading again while the retry is in flight, not as the empty state', async () => {
    const retry = deferred<unknown>()
    read.service
      .mockRejectedValueOnce(new Error('relay is down'))
      .mockReturnValueOnce(retry.promise)
    const { api } = await mountHookOnAppClient(read.hook)
    await act(async () => {
      await vi.waitFor(() => expect(api().error).toBeInstanceOf(Error))
    })

    await act(async () => {
      void api().refetch()
      await vi.waitFor(() => expect(api().isLoading).toBe(true))
    })

    expect(api().error).toBeNull()

    await act(async () => {
      retry.resolve(read.value)
      await vi.waitFor(() => expect(api().data).toBeDefined())
    })
  })
})
