import type {
  SkillAuditResponse,
  SkillCuratedResponse,
  SkillDetail,
  SkillListResponse,
  SkillSearchResponse
} from '@actovia/shared/types/skills'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'

// Shared by the three use-skills-registry test files. Each file keeps its own
// `vi.mock`s (the service, i18n, report-error, the toast) and its own table of
// reads: a mock registered here would not be the file's own.

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

// Roots a test mounted, unmounted by `unmountAll()` in afterEach so none
// outlives its test (a leaked root stays subscribed to the focus manager).
const mounted: Array<() => Promise<void>> = []

export async function unmountAll() {
  for (const unmount of mounted.splice(0)) await unmount()
}

// Mounts on a client the test owns, so a second mount can share its cache and
// the first can be unmounted (the tab closing and opening again).
export async function mountOn<T>(queryClient: QueryClient, hook: () => T) {
  let latest: T | undefined
  const root = createRoot(document.createElement('div'))
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Probe<T>, {
          hook,
          onReady: (value) => {
            latest = value
          }
        })
      )
    )
  })
  const unmount = async () => {
    await act(async () => {
      root.unmount()
    })
  }
  mounted.push(unmount)
  return { api: () => latest!, unmount }
}

export const plainClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

export async function mountHook<T>(hook: () => T) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  return { queryClient, ...(await mountOn(queryClient, hook)) }
}

// The app's own client, so a failing read goes through the real
// `queryCache.onError`. Needs `@/lib/i18n`, `@/lib/report-error` and
// `@/components/ui/toast` mocked by the caller (imported late, so their
// mocks are in place).
export async function appClient() {
  const { createAppQueryClient } = await import('@/lib/query-client')
  return createAppQueryClient()
}

// The app's client with retries off, so a failure lands without a backoff.
export async function noRetryAppClient() {
  const queryClient = await appClient()
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false }
  })
  return queryClient
}

export async function mountHookOnAppClient<T>(hook: () => T) {
  const queryClient = await noRetryAppClient()
  return { queryClient, ...(await mountOn(queryClient, hook)) }
}

export async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

export const item = (n: number) => ({
  id: `owner/repo/skill-${n}`,
  slug: `skill-${n}`,
  name: `skill-${n}`,
  source: 'owner/repo',
  installs: 100 - n,
  sourceType: 'github',
  installUrl: 'https://github.com/owner/repo',
  url: `https://skills.sh/owner/repo/skill-${n}`
})

export const page = (
  n: number,
  hasMore: boolean,
  total = 57
): SkillListResponse => ({
  data: [item(n)],
  pagination: { page: n, perPage: 24, total, hasMore }
})

export const searchResponse: SkillSearchResponse = {
  data: [item(1)],
  query: 'pdf',
  searchType: 'fuzzy',
  count: 1,
  durationMs: 4
}

export const ID = 'anthropics/skills/pdf'

export const detail: SkillDetail = {
  id: ID,
  source: 'anthropics/skills',
  slug: 'pdf',
  installs: 9,
  hash: 'abc',
  files: [{ path: 'SKILL.md', contents: '# PDF' }]
}

export const audit: SkillAuditResponse = {
  id: ID,
  source: 'anthropics/skills',
  slug: 'pdf',
  audits: []
}

export const curated: SkillCuratedResponse = {
  data: [],
  totalOwners: 0,
  totalSkills: 0,
  generatedAt: '2026-09-23T00:00:00.000Z'
}
