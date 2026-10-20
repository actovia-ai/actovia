# SWR → @tanstack/react-query Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SWR with `@tanstack/react-query` across the renderer, and use the move to make
every domain's data layer consistent: `services/*.ts` stay pure fetch functions, every domain gets
exactly one `hooks/use-<domain>.ts` wrapping them in `useQuery`/`useMutation`, no component imports
`useQuery`/`useMutation` directly, and errors/toasts go through one centralized surface instead of
being scattered per call site.

**Architecture:** A single `QueryClient` (`src/renderer/lib/query-client.ts`) with global
`queryCache.onError` (report, never toast) and `mutationCache.onError` (report and toast by
default) callbacks, replacing `SWRConfig` in `main.tsx`. Query keys are typed factories, one per
domain, colocated with that domain's hook file. `services/*.ts` lose their inline `sileo`/`mutate`
side effects — those move into the hook that calls them.

**Tech Stack:** `@tanstack/react-query` v5, `@tanstack/react-query-devtools` (dev-only), React 19,
TypeScript, Vitest + happy-dom for hook tests.

**Spec:** `docs/superpowers/specs/2026-09-23-react-query-migration-design.md`

## Global Constraints

- `bun run fmt` → `bun run lint` → `bun run typecheck` → `bun run i18n:check` → `bun run test` must
  pass before every commit (the project's pre-commit gate).
- Stage files by name (`git add <files>`); never `git add -A`.
- Every commit ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Package/lockfile: any `package.json` change ships with a regenerated `bun.lock` in the same
  commit. On this branch, a bare `bun install` with no `package.json` change still rewrites
  `bun.lock` (it prunes ~108 stale, unrelated platform-optional-binding lines left over from a
  different branch's install state) — run `git checkout -- bun.lock` to discard that incidental
  diff before any commit that isn't itself the intentional dependency-add in Task 1.
- No component ever imports `useQuery`, `useMutation`, `useInfiniteQuery`, or `useQueryClient`
  directly — always through a domain hook in `src/renderer/hooks/`.
- `services/*.ts` functions take no dependency on React or React Query; they return whatever
  `fetcher<T>()` resolves to and nothing else (no `sileo`, no `mutate`).
- The live chat stream (`src/renderer/lib/stream-manager.ts`) is untouched by this migration —
  confirmed it doesn't reference SWR at all.
- Test pattern for every new/changed hook: `// @vitest-environment happy-dom`, `createRoot` + `act`
  from `react-dom/client`/`react`, `createElement` (no JSX) — matching
  `tests/unit/renderer/hooks/use-chat.test.ts`.

---

## File inventory (accurate for this branch, `feat/react-query` off `origin/master`)

`services/*.ts` this plan touches: `chat.ts`, `settings.ts`, `backup.ts`, `skills.ts`,
`discover.ts`, `mcp-service.ts`, `project.ts`, `computer-use.ts`, `deep-research.ts`,
`analytics.ts`. (`audio.ts`, `db.ts`, `knowledge-base.ts`, `memory.ts`, `philharmonic*.ts`,
`tools.ts`, `upload.ts`, `usage.ts` have no `useSWR` consumer on this branch and are out of scope.)

The 22 `useSWR` call sites this plan migrates:

| #   | File                                                                            | Domain                  |
| --- | ------------------------------------------------------------------------------- | ----------------------- |
| 1   | `hooks/use-settings.ts`                                                         | settings                |
| 2   | `containers/chat-detail.tsx`                                                    | chat/history            |
| 3   | `layouts/chat-layout/nav-histories.tsx`                                         | chat/history            |
| 4   | `components/chat.tsx` (`ProjectBreadcrumb` + `onFinish`/`onTitle`)              | chat/history + project  |
| 5   | `layouts/chat-layout/nav-projects.tsx`                                          | project                 |
| 6   | `containers/project-detail.tsx`                                                 | project                 |
| 7   | `layouts/chat-layout/search-dialog.tsx`                                         | search                  |
| 8   | `components/settings/settings-form/profile.tsx`                                 | settings: profile       |
| 9   | `components/settings/settings-form/providers/ollama.tsx`                        | settings: providers     |
| 10  | `components/settings/settings-form/data-controls.tsx`                           | settings: data controls |
| 11  | `components/settings/settings-form/logger.tsx`                                  | settings: logger        |
| 12  | `components/settings/settings-form/chat-audit.tsx`                              | settings: chat audit    |
| 13  | `components/settings/settings-form/mcp-servers.tsx`                             | mcp                     |
| 14  | `components/composer-tools.tsx`                                                 | mcp                     |
| 15  | `hooks/use-discover-feed.ts`                                                    | discover                |
| 16  | `hooks/use-installed-apps.ts`                                                   | computer use            |
| 17  | `components/skills-market/index.tsx`                                            | skills                  |
| 18  | `components/skills-market/leaderboard.tsx` (2 hooks: search + `useSWRInfinite`) | skills                  |
| 19  | `components/skills-market/skill-detail.tsx`                                     | skills                  |
| 20  | `components/skills-market/installed-list.tsx`                                   | skills                  |
| 21  | `components/deep-research/index.tsx`                                            | deep research           |
| 22  | `components/calling-tools/deep-research/deep-research-card.tsx`                 | deep research           |

---

### Task 1: `QueryClient`, global error handling, `main.tsx` wiring

**Files:**

- Create: `src/renderer/lib/query-client.ts`
- Modify: `src/renderer/main.tsx`
- Modify: `package.json`, `bun.lock`
- Test: `tests/unit/renderer/lib/query-client.test.ts`

**Interfaces:**

- Produces: `queryClient: QueryClient` (default export from `query-client.ts`), used by every
  later task's tests and by `main.tsx`.
- Produces: the `meta` shape every mutation in later tasks sets:
  `{ errorTitle?: string; silent?: boolean }` (both optional).

- [ ] **Step 1: Add the dependency**

```bash
bun add @tanstack/react-query
bun add -D @tanstack/react-query-devtools
```

- [ ] **Step 2: Stage and commit the dependency add on its own**

```bash
git add package.json bun.lock
git commit -m "chore: add @tanstack/react-query

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Write the failing test for the global error callbacks**

```typescript
// tests/unit/renderer/lib/query-client.test.ts
// @vitest-environment happy-dom
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

const report = vi.fn()
vi.mock('@/lib/report-error', () => ({
  reportRendererError: (...args: unknown[]) => report(...args)
}))
const sileoError = vi.fn()
vi.mock('sileo', () => ({
  sileo: { error: (...args: unknown[]) => sileoError(...args) }
}))

const { createAppQueryClient } = await import('@/lib/query-client')

describe('createAppQueryClient', () => {
  afterEach(() => {
    report.mockClear()
    sileoError.mockClear()
  })

  it('a failed query reports but never toasts', async () => {
    const client = createAppQueryClient()
    await client
      .fetchQuery({
        queryKey: ['boom-query'],
        queryFn: () => Promise.reject(new Error('read failed'))
      })
      .catch(() => {})

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: ['boom-query']
    })
    expect(sileoError).not.toHaveBeenCalled()
  })

  it('a failed mutation reports and toasts, using meta.errorTitle', async () => {
    const client = createAppQueryClient()
    await client
      .getMutationCache()
      .build(client, {
        mutationKey: ['boom-mutation'],
        mutationFn: () => Promise.reject(new Error('write failed')),
        meta: { errorTitle: 'Could not save' }
      })
      .execute(undefined)
      .catch(() => {})

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('mutation', expect.any(Error), {
      mutationKey: ['boom-mutation']
    })
    expect(sileoError).toHaveBeenCalledWith({
      title: 'Could not save',
      description: 'write failed'
    })
  })

  it('meta.silent suppresses the toast but still reports', async () => {
    const client = createAppQueryClient()
    await client
      .getMutationCache()
      .build(client, {
        mutationKey: ['silent-mutation'],
        mutationFn: () => Promise.reject(new Error('write failed')),
        meta: { silent: true }
      })
      .execute(undefined)
      .catch(() => {})

    expect(report).toHaveBeenCalledTimes(1)
    expect(sileoError).not.toHaveBeenCalled()
  })

  it('a mutation with no meta.errorTitle falls back to a generic title', async () => {
    const client = createAppQueryClient()
    await client
      .getMutationCache()
      .build(client, {
        mutationKey: ['untitled-mutation'],
        mutationFn: () => Promise.reject(new Error('write failed'))
      })
      .execute(undefined)
      .catch(() => {})

    expect(sileoError).toHaveBeenCalledWith({
      title: 'Something went wrong',
      description: 'write failed'
    })
  })
})
```

- [ ] **Step 4: Run it, confirm it fails**

Run: `bunx vitest run tests/unit/renderer/lib/query-client.test.ts`
Expected: FAIL — `Cannot find module '@/lib/query-client'`

- [ ] **Step 5: Implement `query-client.ts`**

```typescript
// src/renderer/lib/query-client.ts
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { sileo } from 'sileo'

import { reportRendererError } from '@/lib/report-error'

/**
 * A mutation's `meta`, read back by the global `mutationCache.onError`
 * below. `errorTitle` is the toast title on failure (falls back to a
 * generic one); `silent: true` skips the toast entirely (reporting still
 * happens — this never means "don't tell the log").
 */
export interface MutationMeta extends Record<string, unknown> {
  errorTitle?: string
  silent?: boolean
}

const GENERIC_ERROR_TITLE = 'Something went wrong'

/**
 * One QueryClient for the app, with two non-overlapping error surfaces:
 * reads report to the structured log only (a failed background read
 * shouldn't interrupt anyone); writes report *and* toast by default, since
 * a mutation is always something the user explicitly asked for. Neither
 * path can produce an unhandled rejection — React Query catches both
 * before they'd ever reach `installGlobalErrorReporting()`'s global
 * listeners, so there is no double-reporting between the two.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        reportRendererError('query', error, { queryKey: query.queryKey })
      }
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        reportRendererError('mutation', error, {
          mutationKey: mutation.options.mutationKey
        })
        const meta = mutation.meta as MutationMeta | undefined
        if (meta?.silent) return
        sileo.error({
          title: meta?.errorTitle ?? GENERIC_ERROR_TITLE,
          description: error instanceof Error ? error.message : String(error)
        })
      }
    }),
    defaultOptions: {
      queries: {
        // SWR's default: don't treat a background read failure as fatal to
        // the UI, and don't hammer the server — React Query's own default
        // (3 retries, exponential backoff) is fine to keep as-is.
        refetchOnWindowFocus: false
      }
    }
  })
}

export const queryClient = createAppQueryClient()
```

- [ ] **Step 6: Run the test again, confirm it passes**

Run: `bunx vitest run tests/unit/renderer/lib/query-client.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Wire `QueryClientProvider` into `main.tsx`, alongside `SWRConfig`**

Both providers coexist for the duration of the migration (Task 17 removes `SWRConfig`) — they use
separate caches, so there's no interaction between them.

```typescript
// src/renderer/main.tsx
import '@/assets/stylesheets/globals.css'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { fetcher } from '@actovia/shared/utils/http'
import { Provider } from 'jotai'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { SWRConfig } from 'swr'

import 'react-medium-image-zoom/dist/styles.css'
import { I18nProvider } from '@/components/i18n-provider'
import { LockScreen } from '@/components/lock/lock-screen'
import { ThemeProvider } from '@/components/theme-provider'
import { ToneBridge } from '@/components/tone-bridge'
import { useLock } from '@/hooks/use-lock'
import { i18nReady } from '@/lib/i18n'
import { queryClient } from '@/lib/query-client'
import { bootTone } from '@/lib/tone'
import { router } from '@/routes'

// First paint already carries the user's colour tone: apply the cached value
// synchronously, before anything renders. ToneBridge keeps it live.
bootTone()

function AppRoot() {
  const { status, refresh, locked } = useLock()

  if (status === null) return null
  if (locked) return <LockScreen status={status} onUnlocked={refresh} />
  return <RouterProvider router={router} />
}

void i18nReady.finally(() => {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <QueryClientProvider client={queryClient}>
      <SWRConfig value={{ fetcher }}>
        <Provider>
          <ThemeProvider>
            <I18nProvider>
              <ToneBridge />
              <AppRoot />
            </I18nProvider>
          </ThemeProvider>
        </Provider>
      </SWRConfig>
      {import.meta.env.DEV && <ReactQueryDevtools buttonPosition="bottom-left" />}
    </QueryClientProvider>
  )
})
```

- [ ] **Step 8: Verify the app still boots**

Run: `bun run typecheck:web`
Expected: PASS — no type errors from the provider nesting.

- [ ] **Step 9: Gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/lib/query-client.ts src/renderer/main.tsx tests/unit/renderer/lib/query-client.test.ts
git commit -m "feat(query): QueryClient with centralized error reporting

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Shared hook-test harness

**Files:**

- Create: `tests/unit/helpers/query-test-utils.ts`
- Test: covered by every later task's own hook tests using this helper (no standalone test for
  the helper itself — it has no logic beyond wiring, and every task that uses it exercises it).

**Interfaces:**

- Consumes: nothing from Task 1 directly (creates its own isolated `QueryClient` per call, never
  the app-wide singleton — tests must not share cache state with each other).
- Produces: `renderWithQueryClient(node: ReactNode): { host: HTMLDivElement, queryClient:
  QueryClient }`, used by every hook/component test from Task 3 onward.

- [ ] **Step 1: Write the helper**

```typescript
// tests/unit/helpers/query-test-utils.ts
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

/**
 * Renders `node` inside a fresh, isolated `QueryClient` (retry disabled —
 * a test asserting an error path shouldn't wait through React Query's
 * default backoff) for a hook/component test. Each call gets its own
 * client and DOM host, so tests never leak cache state between each other.
 */
export async function renderWithQueryClient(
  node: ReactNode
): Promise<{ host: HTMLDivElement; queryClient: QueryClient }> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  const host = document.createElement('div')
  await act(async () => {
    createRoot(host).render(
      createElement(QueryClientProvider, { client: queryClient }, node)
    )
  })
  return { host, queryClient }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `bun run typecheck:node` (tests are covered by `tsconfig.test.json`, not gated in the main
typecheck script, but should still compile cleanly — open the file in an editor or run
`bunx tsc --noEmit -p tsconfig.test.json` if available)
Expected: no errors reported for this file.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/helpers/query-test-utils.ts
git commit -m "test: a shared QueryClientProvider harness for hook tests

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `hooks/use-settings.ts` — the optimistic-update case

This is the one call site with behavior that must survive exactly: after a save, the local cache
is updated with the just-saved payload _without_ a revalidating GET (a GET would bring back a
freshly-bumped `updatedAt`, which echoes through `useForm({ values: settings })` and loops the
autosave).

**Files:**

- Modify: `src/renderer/hooks/use-settings.ts`
- Test: `tests/unit/renderer/hooks/use-settings.test.ts` (create if it doesn't exist; check first)

**Interfaces:**

- Consumes: `queryClient` pattern from Task 1 (via `useQueryClient()` inside the hook, not the
  singleton import — this hook runs inside `QueryClientProvider`, so the context-provided client is
  correct and is what a test's `renderWithQueryClient` supplies).
- Produces: `settingsKeys = { all: ['settings'] as const }` — exported from this file; Tasks 4, 7,
  and any other consumer of `useSettings()` import this hook, never the key directly (nothing else
  needs `settingsKeys` — `useSettings()` is the only reader/writer of this query in the app).

- [ ] **Step 1: Check for an existing test file**

Run: `ls tests/unit/renderer/hooks/use-settings.test.ts`
If it exists, read it first and preserve every assertion it makes (adapting mocks from
`vi.mock('swr', ...)` to the new shape) rather than replacing it — its existing coverage is the
save-success-toast and save-error-toast paths as of today's code.

- [ ] **Step 2: Write the failing test (new assertions on top of what Step 1 preserved)**

```typescript
// tests/unit/renderer/hooks/use-settings.test.ts
// @vitest-environment happy-dom
import type { Settings } from '@actovia/shared/schemas/settings-schema'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../../helpers/query-test-utils'

const updateSettingsService = vi.fn()
vi.mock('@/services/settings', () => ({
  updateSettings: (...args: unknown[]) => updateSettingsService(...args)
}))
const sileoSuccess = vi.fn()
const sileoError = vi.fn()
vi.mock('sileo', () => ({
  sileo: {
    success: (...args: unknown[]) => sileoSuccess(...args),
    error: (...args: unknown[]) => sileoError(...args)
  }
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false }
  })
}))

const { useSettings, settingsKeys } = await import('@/hooks/use-settings')

function Probe({
  onReady
}: {
  onReady: (api: ReturnType<typeof useSettings>) => void
}) {
  const api = useSettings()
  onReady(api)
  return null
}

describe('useSettings', () => {
  afterEach(() => {
    updateSettingsService.mockClear()
    sileoSuccess.mockClear()
    sileoError.mockClear()
  })

  it('after a successful save, the cache holds the merged payload with no revalidating GET', async () => {
    updateSettingsService.mockResolvedValue(undefined)
    let latest: ReturnType<typeof useSettings> | undefined
    const { queryClient } = await renderWithQueryClient(
      createElement(Probe, { onReady: (api) => (latest = api) })
    )
    queryClient.setQueryData(settingsKeys.all, {
      language: 'en',
      updatedAt: '2026-01-01T00:00:00Z'
    } as unknown as Settings)

    const payload = { language: 'ja' } as unknown as Settings
    await latest!.updateSettings(payload)

    const cached = queryClient.getQueryData<Settings>(settingsKeys.all)
    expect(cached).toMatchObject({ language: 'ja' })
    // No new fetch was queued for this query — a revalidating GET would
    // mark it as fetching/invalid; instead the cache was written directly.
    expect(queryClient.getQueryState(settingsKeys.all)?.fetchStatus).toBe(
      'idle'
    )
    expect(sileoSuccess).toHaveBeenCalledTimes(1)
  })

  it('a failed save toasts an error and leaves the cache untouched', async () => {
    updateSettingsService.mockRejectedValue(new Error('network down'))
    let latest: ReturnType<typeof useSettings> | undefined
    const { queryClient } = await renderWithQueryClient(
      createElement(Probe, { onReady: (api) => (latest = api) })
    )
    const before = { language: 'en' } as unknown as Settings
    queryClient.setQueryData(settingsKeys.all, before)

    await latest!.updateSettings({ language: 'ja' } as unknown as Settings)

    expect(queryClient.getQueryData(settingsKeys.all)).toBe(before)
    expect(sileoSuccess).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `bunx vitest run tests/unit/renderer/hooks/use-settings.test.ts`
Expected: FAIL — `settingsKeys` is not exported, `useSettings` still uses `useSWR`.

- [ ] **Step 4: Rewrite the hook**

```typescript
// src/renderer/hooks/use-settings.ts
import type { Settings } from '@actovia/shared/schemas/settings-schema'
import { getHttpErrorMessage, toErrorI18n } from '@actovia/shared/utils/http'
import { fetcher } from '@actovia/shared/utils/http'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { updateSettings as updateSettingsService } from '@/services/settings'

export const settingsKeys = { all: ['settings'] as const }

export function useSettings() {
  const { t, i18n } = useTranslation(['errors', 'settings'])
  const queryClient = useQueryClient()
  const { data, error, isLoading } = useQuery({
    queryKey: settingsKeys.all,
    queryFn: () => fetcher<Settings>('/api/v1/settings')
  })

  const updateSettings = async (payload: Settings) => {
    try {
      await updateSettingsService(payload)
    } catch (err) {
      sileo.error({
        title: t('settings:toast.saveFailed'),
        description: getHttpErrorMessage(err, toErrorI18n(i18n))
      })
      return
    }
    // Merge into the cache directly — no invalidateQueries/refetch. A
    // revalidating GET would bring back a freshly-bumped `updatedAt`,
    // which echoes through `useForm({ values: settings })` → RHF resets
    // the form → watch fires for the timestamp field → autosave fires
    // again → infinite POST/GET loop. See the test for this file.
    queryClient.setQueryData(
      settingsKeys.all,
      (current: Settings | undefined) =>
        ({ ...current, ...payload }) as Settings
    )
    sileo.success({ title: t('settings:toast.autoSaved') })
  }

  return {
    data,
    isLoading,
    error,
    updateSettings
  }
}
```

- [ ] **Step 5: Run the test again, confirm it passes**

Run: `bunx vitest run tests/unit/renderer/hooks/use-settings.test.ts`
Expected: PASS

- [ ] **Step 6: Gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/hooks/use-settings.ts tests/unit/renderer/hooks/use-settings.test.ts
git commit -m "feat(query): migrate useSettings, preserving the no-revalidate save

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Chat & history domain

**Files:**

- Modify: `src/renderer/services/chat.ts` (strip `mutate`/`sileo`, keep pure fetch)
- Create: `src/renderer/hooks/use-chat-history.ts` (the `historyKeys` factory + query/mutation hooks)
- Modify: `src/renderer/containers/chat-detail.tsx`
- Modify: `src/renderer/layouts/chat-layout/nav-histories.tsx`
- Modify: `src/renderer/components/chat.tsx` (the `/api/v1/history` mutate calls only — the
  `ProjectBreadcrumb` sub-component and its `/api/v1/project/:id` read move in Task 5, since that's
  the project domain's key)
- Test: `tests/unit/renderer/hooks/use-chat-history.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks beyond the `QueryClientProvider`/error-reporting plumbing.
- Produces: `historyKeys = { all: ['history'] as const, detail: (id: string) => [...historyKeys.all,
  'detail', id] as const }`; `useChatHistory()` (returns `{ data, isLoading }` for the full list,
  used by `nav-histories.tsx`); `useChatMessages(id: string | undefined)` (returns `{ data,
  isLoading }` for one chat's messages, used by `chat-detail.tsx`); `useUpdateChat()` and
  `useDeleteChat()` (mutation hooks, replacing `services/chat.ts`'s side-effecting versions) —
  Task 5 and Task 7 (`profile.tsx`, which reads chat count via `/api/v1/history`) import
  `historyKeys`/`useChatHistory` from this file rather than re-deriving the key.

- [ ] **Step 1: Strip side effects from `services/chat.ts`**

```typescript
// src/renderer/services/chat.ts
import { fetcher } from '@actovia/shared/utils/http'

import { Chat } from '@/types/db'

export const updateChat = (payload: Partial<Chat>) =>
  fetcher<void>('/api/v1/chat', { method: 'PUT', body: payload })

export const deleteChat = (id: string) =>
  fetcher<void>(`/api/v1/chat/${id}`, { method: 'DELETE' })
```

(`deleteChat` drops the `currentId` param — the "if this was the active chat, navigate home" logic
moves to the hook's `onSuccess`, since it's a UI concern, not a fetch concern.)

- [ ] **Step 2: Write the failing test for the new hook**

```typescript
// tests/unit/renderer/hooks/use-chat-history.test.ts
// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../../helpers/query-test-utils'

const fetcher = vi.fn()
vi.mock('@actovia/shared/utils/http', () => ({
  fetcher: (...args: unknown[]) => fetcher(...args)
}))
const updateChat = vi.fn()
const deleteChat = vi.fn()
vi.mock('@/services/chat', () => ({
  updateChat: (...args: unknown[]) => updateChat(...args),
  deleteChat: (...args: unknown[]) => deleteChat(...args)
}))
vi.mock('@/lib/i18n', () => ({ i18n: { t: (key: string) => key } }))
const sileoSuccess = vi.fn()
vi.mock('sileo', () => ({
  sileo: { success: (...args: unknown[]) => sileoSuccess(...args) }
}))

const { historyKeys, useChatHistory, useUpdateChat, useDeleteChat } =
  await import('@/hooks/use-chat-history')

function Probe<T>({
  hook,
  onReady
}: {
  hook: () => T
  onReady: (v: T) => void
}) {
  onReady(hook())
  return null
}

describe('useChatHistory', () => {
  afterEach(() => {
    fetcher.mockClear()
    updateChat.mockClear()
    deleteChat.mockClear()
    sileoSuccess.mockClear()
  })

  it('fetches the list at historyKeys.all', async () => {
    fetcher.mockResolvedValue([{ id: '1', title: 'Chat one' }])
    let latest: ReturnType<typeof useChatHistory> | undefined
    const { queryClient } = await renderWithQueryClient(
      createElement(Probe, {
        hook: useChatHistory,
        onReady: (v) => (latest = v)
      })
    )
    await queryClient.ensureQueryData({
      queryKey: historyKeys.all,
      queryFn: () => fetcher()
    })
    expect(fetcher).toHaveBeenCalledWith('/api/v1/history')
    expect(latest).toBeDefined()
  })
})

describe('useUpdateChat', () => {
  afterEach(() => {
    updateChat.mockClear()
    sileoSuccess.mockClear()
  })

  it('invalidates the history list and toasts on success', async () => {
    updateChat.mockResolvedValue(undefined)
    let latest: ReturnType<typeof useUpdateChat> | undefined
    const { queryClient } = await renderWithQueryClient(
      createElement(Probe, {
        hook: useUpdateChat,
        onReady: (v) => (latest = v)
      })
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await latest!.mutateAsync({ id: '1', favorite: true })
    expect(updateChat).toHaveBeenCalledWith({ id: '1', favorite: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: historyKeys.all })
    expect(sileoSuccess).toHaveBeenCalledWith({
      title: 'chat:toast.chatUpdated'
    })
  })
})

describe('useDeleteChat', () => {
  afterEach(() => {
    deleteChat.mockClear()
    sileoSuccess.mockClear()
  })

  it('invalidates the history list and toasts with the chat title', async () => {
    deleteChat.mockResolvedValue(undefined)
    let latest: ReturnType<typeof useDeleteChat> | undefined
    const { queryClient } = await renderWithQueryClient(
      createElement(Probe, {
        hook: useDeleteChat,
        onReady: (v) => (latest = v)
      })
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await latest!.mutateAsync({ id: '1', title: 'Old chat' })
    expect(deleteChat).toHaveBeenCalledWith('1')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: historyKeys.all })
    expect(sileoSuccess).toHaveBeenCalledWith({
      title: 'chat:toast.chatDeleted',
      description: 'Old chat'
    })
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `bunx vitest run tests/unit/renderer/hooks/use-chat-history.test.ts`
Expected: FAIL — `Cannot find module '@/hooks/use-chat-history'`

- [ ] **Step 4: Implement the hook**

```typescript
// src/renderer/hooks/use-chat-history.ts
import { fetcher } from '@actovia/shared/utils/http'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { sileo } from 'sileo'

import { i18n } from '@/lib/i18n'
import { deleteChat, updateChat } from '@/services/chat'
import type { Chat } from '@/types/db'

export const historyKeys = {
  all: ['history'] as const,
  detail: (id: string) => [...historyKeys.all, 'detail', id] as const
}

export function useChatHistory() {
  const { data, isLoading } = useQuery({
    queryKey: historyKeys.all,
    queryFn: () => fetcher<Chat[]>('/api/v1/history')
  })
  return { data, isLoading }
}

export function useChatMessages(id: string | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: id ? historyKeys.detail(id) : historyKeys.detail('none'),
    queryFn: () => fetcher(`/api/v1/chat/${id}`),
    enabled: !!id
  })
  return { data, isLoading }
}

export function useUpdateChat() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateChat,
    meta: { errorTitle: i18n.t('errors:generic') },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: historyKeys.all })
      sileo.success({ title: i18n.t('chat:toast.chatUpdated') })
    }
  })
}

export function useDeleteChat() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (chat: Pick<Chat, 'id' | 'title'>) => deleteChat(chat.id),
    meta: { errorTitle: i18n.t('errors:generic') },
    onSuccess: (_void, chat) => {
      queryClient.invalidateQueries({ queryKey: historyKeys.all })
      sileo.success({
        title: i18n.t('chat:toast.chatDeleted'),
        description: chat.title
      })
    }
  })
}
```

Check `errors:generic` exists as a catalog key before using it (`grep -n '"generic"'
packages/shared/src/i18n/locales/en/errors.json`); if it doesn't, add it (all ten locales, per the
project's i18n rule) rather than inventing a key that fails `bun run i18n:check`.

- [ ] **Step 5: Run the test again, confirm it passes**

Run: `bunx vitest run tests/unit/renderer/hooks/use-chat-history.test.ts`
Expected: PASS

- [ ] **Step 6: Migrate `containers/chat-detail.tsx`**

```typescript
// src/renderer/containers/chat-detail.tsx
import { useSetAtom } from 'jotai'
import { useEffect, useMemo } from 'react'
import { useParams } from 'react-router'

import { Chat } from '@/components/chat'
import { useChatHistory, useChatMessages } from '@/hooks/use-chat-history'
import { convertToUIMessages } from '@/lib/utils'
import { openTabsAtom } from '@/stores/chat'

export function ChatDetail() {
  const { id } = useParams()
  const { data: messagesFromDb, isLoading } = useChatMessages(id)
  const { data: history } = useChatHistory()
  const setOpenTabs = useSetAtom(openTabsAtom)

  useEffect(() => {
    if (!id || !history?.length) return
    const chat = history.find((c) => c.id === id)
    if (!chat) return
    setOpenTabs((prev) =>
      prev.find((t) => t.id === id) ? prev : [...prev, { id, title: chat.title }]
    )
  }, [id, history, setOpenTabs])

  const initialMessages = useMemo(
    () => convertToUIMessages(messagesFromDb ?? []),
    [messagesFromDb]
  )

  const chatRecord = history?.find((c) => c.id === id)

  if (!id || isLoading || !messagesFromDb) return null

  return (
    <Chat
      key={id}
      id={id}
      initialMessages={initialMessages}
      projectId={chatRecord?.projectId ?? undefined}
      chatTitle={chatRecord?.title ?? 'New chat'}
    />
  )
}
```

(`useChatHistory()`'s default `data` is `undefined`, matching SWR's un-seeded state — the original
passed `fallbackData: []`; check every caller of `history` here tolerates `undefined` the same way
`history?.length`/`history?.find` already do, and skip re-adding a `[]` default at the query level
so it stays a single source of truth for "hasn't loaded yet" vs. "loaded, empty".)

- [ ] **Step 7: Migrate `layouts/chat-layout/nav-histories.tsx`**

Read the file's current `useSWR` line and its `updateChat` call site first
(`grep -n "useSWR\|updateChat" src/renderer/layouts/chat-layout/nav-histories.tsx`) to get exact
surrounding context (destructured variable names used elsewhere in the file), then:

- Replace `const { data: history, isLoading } = useSWR<Chat[]>('/api/v1/history', {...})` with
  `const { data: history, isLoading } = useChatHistory()`.
- Replace the `updateChat({ id: chat.id, favorite: !chat.favorite })` call with
  `useUpdateChat().mutate({ id: chat.id, favorite: !chat.favorite })` (call `useUpdateChat()` once
  at the top of the component, not per-row).
- Remove the `import useSWR from 'swr'` and `import { updateChat } from '@/services/chat'` lines;
  add `import { useChatHistory, useUpdateChat } from '@/hooks/use-chat-history'`.

- [ ] **Step 8: Migrate the two `mutate('/api/v1/history')` calls in `components/chat.tsx`**

```typescript
// src/renderer/components/chat.tsx — only the historyKeys-related lines change;
// the ProjectBreadcrumb sub-component is Task 5's, leave it as-is here.
```

Replace `import useSWR, { mutate } from 'swr'` with `import { useQueryClient } from
'@tanstack/react-query'` plus `import { historyKeys } from '@/hooks/use-chat-history'`, add `const
queryClient = useQueryClient()` inside the component, and replace both
`mutate('/api/v1/history')` call sites (in `onFinish` and `onTitle`) with
`queryClient.invalidateQueries({ queryKey: historyKeys.all })`.

- [ ] **Step 9: Verify no remaining references to the old shape**

Run: `grep -rn "from '@/services/chat'\|useSWR.*history\|mutate('/api/v1/history')" src/renderer`
Expected: no output (everything now goes through `use-chat-history.ts`).

- [ ] **Step 10: Full gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/services/chat.ts src/renderer/hooks/use-chat-history.ts \
  src/renderer/containers/chat-detail.tsx src/renderer/layouts/chat-layout/nav-histories.tsx \
  src/renderer/components/chat.tsx tests/unit/renderer/hooks/use-chat-history.test.ts
git commit -m "feat(query): migrate the chat & history domain

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 11: Feel-check the render-path guard**

Run: `bunx vitest run tests/unit/renderer/components/messages-rerender.test.ts tests/unit/renderer/hooks/use-chat.test.ts`
Expected: PASS, unchanged — these guard the streaming re-render discipline this migration must not
touch; if either fails, the regression is in this task, not in `use-chat.ts` itself.

---

### Task 5: Project domain

**Files:**

- Modify: `src/renderer/services/project.ts` (strip `mutate`/`sileo`)
- Create: `src/renderer/hooks/use-projects.ts`
- Modify: `src/renderer/layouts/chat-layout/nav-projects.tsx`
- Modify: `src/renderer/containers/project-detail.tsx`
- Modify: `src/renderer/components/chat.tsx` (`ProjectBreadcrumb` only)
- Test: `tests/unit/renderer/hooks/use-projects.test.ts`

**Interfaces:**

- Consumes: `historyKeys` from Task 4 is NOT reused here — `project-detail.tsx`'s
  `/api/v1/history?projectId=${id}` is a distinct query (filtered), gets its own key
  (`projectKeys.chats(id)`) rather than colliding with the unfiltered history list.
- Produces: `projectKeys = { all: ['project'] as const, detail: (id: string) => [...projectKeys.all,
  'detail', id] as const, chats: (id: string) => [...projectKeys.all, 'chats', id] as const }`;
  `useProjects()`, `useProject(id)`, `useProjectChats(id)`, `useCreateProject()`,
  `useUpdateProject()`, `useDeleteProject()`.

- [ ] **Step 1: Strip side effects from `services/project.ts`**

```typescript
// src/renderer/services/project.ts
import { fetcher } from '@actovia/shared/utils/http'

import type { Project } from '@/types/db'

interface CreateProjectInput {
  name: string
  description?: string
  instructions?: string
  structuredInstructions?: {
    tone?: string
    role?: string
    responseFormat?: string
    constraints?: string
  }
}
type UpdateProjectInput = Partial<CreateProjectInput>

export const getProjects = () => fetcher<Project[]>('/api/v1/project')

export const getProject = (id: string) =>
  fetcher<Project & { chatCount: number }>(`/api/v1/project/${id}`)

export const createProject = (data: CreateProjectInput) =>
  fetcher<Project>('/api/v1/project', { method: 'POST', body: data as never })

export const updateProject = (id: string, data: UpdateProjectInput) =>
  fetcher<Project>(`/api/v1/project/${id}`, {
    method: 'PUT',
    body: data as never
  })

export const deleteProject = (id: string) =>
  fetcher<void>(`/api/v1/project/${id}`, { method: 'DELETE' })
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/unit/renderer/hooks/use-projects.test.ts
// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../../helpers/query-test-utils'

const createProject = vi.fn()
const deleteProject = vi.fn()
vi.mock('@/services/project', () => ({
  createProject: (...args: unknown[]) => createProject(...args),
  updateProject: vi.fn(),
  deleteProject: (...args: unknown[]) => deleteProject(...args),
  getProjects: vi.fn(),
  getProject: vi.fn()
}))
vi.mock('@/lib/i18n', () => ({ i18n: { t: (key: string) => key } }))
const sileoSuccess = vi.fn()
vi.mock('sileo', () => ({
  sileo: { success: (...args: unknown[]) => sileoSuccess(...args) }
}))

const { projectKeys, useCreateProject, useDeleteProject } =
  await import('@/hooks/use-projects')

function Probe<T>({
  hook,
  onReady
}: {
  hook: () => T
  onReady: (v: T) => void
}) {
  onReady(hook())
  return null
}

describe('useCreateProject', () => {
  afterEach(() => {
    createProject.mockClear()
    sileoSuccess.mockClear()
  })

  it('invalidates the project list and toasts on success', async () => {
    createProject.mockResolvedValue({ id: '1', name: 'New' })
    let latest: ReturnType<typeof useCreateProject> | undefined
    const { queryClient } = await renderWithQueryClient(
      createElement(Probe, {
        hook: useCreateProject,
        onReady: (v) => (latest = v)
      })
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await latest!.mutateAsync({ name: 'New' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectKeys.all })
    expect(sileoSuccess).toHaveBeenCalledWith({
      title: 'chat:projectDetail.toast.createdTitle'
    })
  })
})

describe('useDeleteProject', () => {
  afterEach(() => {
    deleteProject.mockClear()
    sileoSuccess.mockClear()
  })

  it('invalidates the project list and toasts with the project name', async () => {
    deleteProject.mockResolvedValue(undefined)
    let latest: ReturnType<typeof useDeleteProject> | undefined
    const { queryClient } = await renderWithQueryClient(
      createElement(Probe, {
        hook: useDeleteProject,
        onReady: (v) => (latest = v)
      })
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await latest!.mutateAsync({ id: '1', name: 'Old' })
    expect(deleteProject).toHaveBeenCalledWith('1')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectKeys.all })
    expect(sileoSuccess).toHaveBeenCalledWith({
      title: 'chat:projectDetail.toast.deletedTitle',
      description: 'Old'
    })
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `bunx vitest run tests/unit/renderer/hooks/use-projects.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the hook**

```typescript
// src/renderer/hooks/use-projects.ts
import { fetcher } from '@actovia/shared/utils/http'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { sileo } from 'sileo'

import { i18n } from '@/lib/i18n'
import {
  createProject,
  deleteProject,
  getProject,
  getProjects,
  updateProject
} from '@/services/project'
import type { Chat, Project } from '@/types/db'

export const projectKeys = {
  all: ['project'] as const,
  detail: (id: string) => [...projectKeys.all, 'detail', id] as const,
  chats: (id: string) => [...projectKeys.all, 'chats', id] as const
}

export function useProjects() {
  return useQuery({ queryKey: projectKeys.all, queryFn: getProjects })
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: projectKeys.detail(id ?? 'none'),
    queryFn: () => getProject(id!),
    enabled: !!id
  })
}

export function useProjectChats(id: string | undefined) {
  return useQuery({
    queryKey: projectKeys.chats(id ?? 'none'),
    queryFn: () => fetcher<Chat[]>(`/api/v1/history?projectId=${id}`),
    enabled: !!id
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
      sileo.success({ title: i18n.t('chat:projectDetail.toast.createdTitle') })
    }
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data
    }: {
      id: string
      data: Parameters<typeof updateProject>[1]
    }) => updateProject(id, data),
    onSuccess: (_project, { id }) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) })
      sileo.success({ title: i18n.t('chat:projectDetail.toast.updatedTitle') })
    }
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (project: Pick<Project, 'id' | 'name'>) =>
      deleteProject(project.id),
    onSuccess: (_void, project) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
      sileo.success({
        title: i18n.t('chat:projectDetail.toast.deletedTitle'),
        description: project.name
      })
    }
  })
}
```

- [ ] **Step 5: Run the test again, confirm it passes**

Run: `bunx vitest run tests/unit/renderer/hooks/use-projects.test.ts`
Expected: PASS

- [ ] **Step 6: Migrate `layouts/chat-layout/nav-projects.tsx`**

Read the file's current usage first, then: replace `useSWR<Project[]>('/api/v1/project', {...})`
with `useProjects()`; replace the `createProject({ name: newProjectName.trim() })` call with
`useCreateProject().mutateAsync({ name: newProjectName.trim() })`; replace
`deleteProject(toBeDeletedProject)` with `useDeleteProject().mutateAsync(toBeDeletedProject)`.
Remove the `swr` and `@/services/project` imports; import from `@/hooks/use-projects`.

- [ ] **Step 7: Migrate `containers/project-detail.tsx`**

```typescript
// src/renderer/containers/project-detail.tsx
// Only the data-layer lines change; every JSX/state line below `handleSave` is unchanged.
import type { StructuredInstructions } from '@actovia/shared/schemas/project-schema'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  useProject,
  useProjectChats,
  useUpdateProject
} from '@/hooks/use-projects'
import { useFormat } from '@/lib/format'

export function ProjectDetail() {
  const { t } = useTranslation('chat')
  const { dateTime } = useFormat()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: project } = useProject(id)
  const { data: chats } = useProjectChats(id)
  const updateProjectMutation = useUpdateProject()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [useStructured, setUseStructured] = useState(false)
  const [structured, setStructured] = useState<StructuredInstructions>({})
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    if (!project) return
    setName(project.name)
    setDescription(project.description ?? '')
    setInstructions(project.instructions ?? '')
    const si = project.structuredInstructions
    if (si && Object.values(si).some(Boolean)) {
      setUseStructured(true)
      setStructured(si)
    }
  }, [project])

  const handleSave = async () => {
    if (!id) return
    await updateProjectMutation.mutateAsync({
      id,
      data: {
        name,
        description: description || undefined,
        instructions: instructions || undefined,
        structuredInstructions: useStructured ? structured : undefined
      }
    })
    setIsDirty(false)
  }

  const handleNewChat = () => {
    navigate(`/?projectId=${id}`)
  }

  if (!project) return null

  // ...unchanged JSX below (Input/Textarea/Tabs block using name, description,
  // instructions, useStructured, structured, chats, isDirty, handleSave, handleNewChat)
}
```

The comment marks where the file's existing JSX (everything from `return (` to the closing `)`) is
untouched — copy it verbatim from the current file rather than retyping it.

- [ ] **Step 8: Migrate `ProjectBreadcrumb` in `components/chat.tsx`**

```typescript
// components/chat.tsx — replace the ProjectBreadcrumb function body's data line:
function ProjectBreadcrumb({ projectId }: { projectId: string }) {
  const { data: project } = useProject(projectId)
  // ...rest of the function unchanged
}
```

Add `import { useProject } from '@/hooks/use-projects'` alongside the `use-chat-history` import
from Task 4; the `useSWR` import can now be fully removed from this file if Task 4 hasn't already
removed it.

- [ ] **Step 9: Verify no remaining references**

Run: `grep -rn "from '@/services/project'\|useSWR.*project" src/renderer`
Expected: no output.

- [ ] **Step 10: Full gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/services/project.ts src/renderer/hooks/use-projects.ts \
  src/renderer/layouts/chat-layout/nav-projects.tsx src/renderer/containers/project-detail.tsx \
  src/renderer/components/chat.tsx tests/unit/renderer/hooks/use-projects.test.ts
git commit -m "feat(query): migrate the project domain

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Chat search dialog

**Files:**

- Modify: `src/renderer/layouts/chat-layout/search-dialog.tsx`
- Test: none required — this component has no existing test and the change is a direct,
  same-behavior swap; if a `search-dialog.test.ts` is added later that's independent of this
  migration.

**Interfaces:**

- Consumes: nothing from earlier tasks — this domain has no service file (the endpoint was always
  called by URL through SWR's implicit global fetcher) and no other consumer.

- [ ] **Step 1: Migrate the query**

```typescript
// src/renderer/layouts/chat-layout/search-dialog.tsx
// Replace the import and the query line; everything else in the file is unchanged.
import { ChatMessage } from '@actovia/shared/types/chat'
import { fetcher } from '@actovia/shared/utils/http'
import { useQuery } from '@tanstack/react-query'
import { useAtom } from 'jotai'
// ...other existing imports unchanged (SearchIcon, useState, useTranslation, Link, Dialog*, useDebouncedValue, isFullTextSearchVisibleAtom)

export function SearchDialog() {
  const { t } = useTranslation('chat')
  const [isFullTextSearchVisible, setIsFullTextSearchVisible] = useAtom(
    isFullTextSearchVisibleAtom
  )
  const [query, setQuery] = useState('')
  const debouncedValue = useDebouncedValue(query)

  const handleInputChange = (value: string) => {
    setQuery(value)
  }

  const { data } = useQuery({
    queryKey: ['chat-search', debouncedValue],
    queryFn: () =>
      fetcher<Array<ChatMessage & { title: string; chatId: string }>>(
        `/api/v1/chat/search?query=${debouncedValue}`
      ),
    enabled: !!query
  })

  // ...rest of the component (Dialog/DialogContent JSX) unchanged, except
  // every `data` read that assumed `fallbackData: []` now handles
  // `data ?? []` at the read site instead (check each usage below this line).
```

Read the rest of the file (`sed -n 50,200p src/renderer/layouts/chat-layout/search-dialog.tsx`)
before editing — every place that read `data` assuming it defaults to `[]` (SWR's `fallbackData`)
needs `data ?? []` now, since React Query's un-fetched default is `undefined`.

- [ ] **Step 2: Verify manually**

Run: `bun run typecheck:web`
Expected: PASS — this surfaces every `data`-without-`?? []` spot as a type error if one was missed,
since `Array<...> | undefined` no longer satisfies wherever `.map`/`.length` was called directly.

- [ ] **Step 3: Gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/layouts/chat-layout/search-dialog.tsx
git commit -m "feat(query): migrate the chat search dialog

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Settings → Profile

**Files:**

- Modify: `src/renderer/components/settings/settings-form/profile.tsx`

**Interfaces:**

- Consumes: `useChatHistory` from Task 4 (chat count reuses the exact same query — no new key).
- Produces: nothing new — `usage` and `skills` are one-off reads with no other consumer, given
  inline `useQuery` calls directly in this file rather than a new hook file (Task Right-Sizing:
  splitting a single-consumer one-off read into its own `hooks/use-*.ts` file for no reuse benefit
  would be over-structuring; the project's own convention — `use-settings.ts` — is reserved for a
  genuinely shared or stateful concern, not every read).

Wait — per the plan's own Global Constraint ("no component imports `useQuery`... directly — always
through a domain hook"), profile.tsx's `usage` and `skills` reads still need a hook wrapper, just a
small one colocated rather than a new top-level file, to keep that rule real rather than
special-cased away. Use `hooks/use-usage.ts` for the one (it's plausible another settings page
reads usage later) and inline the `skills`-installed-count read into `hooks/use-installed-skills.ts`
(Task 15 creates a richer version of this file for Skills Market — if Task 15 hasn't run yet when
this task does, create the minimal version here and Task 15 extends it, never replaces it).

- [ ] **Step 1: Create `hooks/use-usage.ts`**

```typescript
import { fetcher } from '@actovia/shared/utils/http'
import { useQuery } from '@tanstack/react-query'

// src/renderer/hooks/use-usage.ts
import type { UsageSummary } from '@/services/usage'

export const usageKeys = { all: ['usage'] as const }

export function useUsage() {
  return useQuery({
    queryKey: usageKeys.all,
    queryFn: () => fetcher<UsageSummary>('/api/v1/usage')
  })
}
```

Check `@/services/usage` actually exports a `UsageSummary` type (`grep -n "UsageSummary"
src/renderer/services/usage.ts`) before importing it — the file exists on this branch per the
earlier `ls services/` output, but wasn't read in the design pass; if the type lives elsewhere,
adjust the import accordingly.

- [ ] **Step 2: Create the minimal `hooks/use-installed-skills.ts`**

```typescript
// src/renderer/hooks/use-installed-skills.ts
import type { InstalledSkill } from '@actovia/shared/types/skills'
import { fetcher } from '@actovia/shared/utils/http'
import { useQuery } from '@tanstack/react-query'

import { INSTALLED_SKILLS_KEY as INSTALLED_SKILLS_URL } from '@/services/skills'

export const installedSkillsKeys = { all: ['installed-skills'] as const }

export function useInstalledSkills() {
  return useQuery({
    queryKey: installedSkillsKeys.all,
    queryFn: () => fetcher<InstalledSkill[]>(INSTALLED_SKILLS_URL)
  })
}
```

- [ ] **Step 3: Migrate `profile.tsx`'s three reads**

```typescript
// components/settings/settings-form/profile.tsx — replace the three useSWR lines:
const { data: usage } = useUsage()
const { data: chats } = useChatHistory()
const { data: skills } = useInstalledSkills()
```

Add `import { useUsage } from '@/hooks/use-usage'`, `import { useChatHistory } from
'@/hooks/use-chat-history'`, `import { useInstalledSkills } from '@/hooks/use-installed-skills'`;
remove `import useSWR from 'swr'`. `chats` here only ever reads `.length` (check with `grep -n
"chats" src/renderer/components/settings/settings-form/profile.tsx` — if it reads more than
`.length`, the migration is still the same, just note the actual usage in case `history`'s richer
shape vs. the original `{ id: string }[]` narrowing matters — it won't, since `useChatHistory()`
returns the full `Chat[]`, a superset).

- [ ] **Step 4: Gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/hooks/use-usage.ts src/renderer/hooks/use-installed-skills.ts \
  src/renderer/components/settings/settings-form/profile.tsx
git commit -m "feat(query): migrate the Profile settings page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Settings → Providers → Ollama

**Files:**

- Modify: `src/renderer/components/settings/settings-form/providers/ollama.tsx`

**Interfaces:**

- Consumes: nothing shared — a one-off ping check, no other consumer.

- [ ] **Step 1: Migrate the ping query**

```typescript
// components/settings/settings-form/providers/ollama.tsx
import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { fetcher } from '@actovia/shared/utils/http'
import { useQuery } from '@tanstack/react-query'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { useSettings } from '@/hooks/use-settings'

import { SettingsRow, SettingsSection } from '../../settings-row'
import { ModelPicker } from './model-picker'

export function Ollama({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const { data: settings } = useSettings()
  const baseUrl = settings?.providers?.ollamaBaseUrl
  const { error } = useQuery({
    queryKey: ['ollama-ping', baseUrl],
    queryFn: () => fetcher(`/api/v1/tools/ping-ollama?url=${baseUrl}`),
    enabled: !!baseUrl
  })

  const isRunning = !!baseUrl && error === null
  // ...rest of the component unchanged
```

Note the behavior change to call out explicitly: SWR's `error` on a hook whose key was `null`
(no `baseUrl` yet) is `undefined`, same as React Query's un-run state — `error === undefined` was
the original check (`isRunning = !!settings?.providers?.ollamaBaseUrl && error === undefined`).
React Query's `error` field is `null` (not `undefined`) both before the first run and after a
successful run — keep the check as `error === undefined` only if verified against the actual
installed version's typing; if `useQuery`'s `error` type is `Error | null`, change the check to
`error == null` (loose equality, matching both `null` and `undefined`) so the comparison is correct
regardless. Verify with the failing-vs-passing test in Step 2 rather than assuming.

- [ ] **Step 2: Manual verification (no existing test for this file)**

Run: `bun run typecheck:web`
Expected: PASS. Then manually confirm via `bun run test:e2e:electron`'s existing Ollama-adjacent
coverage if any exists (`grep -rln "ollama" tests/e2e`) — if none, this is acceptable for a
same-shape data-fetching swap with no behavior change beyond the `error` nullability check above.

- [ ] **Step 3: Gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/components/settings/settings-form/providers/ollama.tsx
git commit -m "feat(query): migrate the Ollama status ping

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Settings → Data Controls

**Files:**

- Modify: `src/renderer/services/backup.ts` (already pure — no change needed to the service itself,
  only its consumer)
- Create: `src/renderer/hooks/use-backup.ts`
- Modify: `src/renderer/components/settings/settings-form/data-controls.tsx`

**Interfaces:**

- Produces: `backupKeys = { status: ['backup', 'status'] as const, list: ['backup', 'list'] as
  const }`, `useBackupStatus()`, `useBackupList()`, `useCreateBackup()`.

- [ ] **Step 1: Implement the hook**

```typescript
// src/renderer/hooks/use-backup.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createBackupNow,
  getBackupStatus,
  listBackups,
  type BackupInfo,
  type BackupStatus
} from '@/services/backup'

export const backupKeys = {
  status: ['backup', 'status'] as const,
  list: ['backup', 'list'] as const
}

export function useBackupStatus() {
  return useQuery({ queryKey: backupKeys.status, queryFn: getBackupStatus })
}

export function useBackupList() {
  return useQuery({ queryKey: backupKeys.list, queryFn: listBackups })
}

export function useCreateBackup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createBackupNow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupKeys.status })
      queryClient.invalidateQueries({ queryKey: backupKeys.list })
    }
  })
}
```

(`services/backup.ts`'s `listBackups`/`getBackupStatus` already exist and are already pure — this
task is the first to actually _call_ them; today's `data-controls.tsx` reads the URLs directly
through SWR's implicit fetcher instead.)

- [ ] **Step 2: Migrate `data-controls.tsx`**

Read the file's `handleBackupNow` function in full first
(`sed -n 70,95p src/renderer/components/settings/settings-form/data-controls.tsx`) to preserve its
`setBackupLoading`/try-catch/toast structure exactly. Replace the two `useSWR` lines:

```typescript
const { data: backupStatus } = useBackupStatus()
const { data: backups } = useBackupList()
const createBackup = useCreateBackup()
```

and inside `handleBackupNow`, replace `await createBackupNow(); mutateStatus(); mutateBackups();`
with `await createBackup.mutateAsync();` (the hook's `onSuccess` now does the invalidation the two
manual `mutate*()` calls did) — keep the surrounding `setBackupLoading(true)`/`sileo.success`/
try-catch exactly as today, since this task only replaces the data-layer calls, not the loading-state
UX.

- [ ] **Step 3: Gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/hooks/use-backup.ts src/renderer/components/settings/settings-form/data-controls.tsx
git commit -m "feat(query): migrate Data Controls backup status/list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Settings → Logger

**Files:**

- Create: `src/renderer/hooks/use-logs.ts`
- Modify: `src/renderer/components/settings/settings-form/logger.tsx`

**Interfaces:**

- Produces: `logsKeys = { entries: (params: string) => ['logs', 'entries', params] as const, dates:
  ['logs', 'dates'] as const, scopes: (date: string) => ['logs', 'scopes', date] as const }`,
  `useLogs(params: URLSearchParams)`, `useLogDates()`, `useLogScopes(date: string)`.

- [ ] **Step 1: Implement the hook**

```typescript
// src/renderer/hooks/use-logs.ts
import { fetcher } from '@actovia/shared/utils/http'
import { useQuery, useQueryClient } from '@tanstack/react-query'

// Match the response shapes logger.tsx already declares/imports today —
// check `grep -n "LogsResponse\|DatesResponse\|ScopesResponse"
// src/renderer/components/settings/settings-form/logger.tsx` for their
// exact definitions or import path before writing this file, and import
// them here rather than redeclaring.
import type {
  DatesResponse,
  LogsResponse,
  ScopesResponse
} from '@/services/analytics'

export const logsKeys = {
  entries: (params: string) => ['logs', 'entries', params] as const,
  dates: ['logs', 'dates'] as const,
  scopes: (date: string) => ['logs', 'scopes', date] as const
}

export function useLogs(paramsString: string) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: logsKeys.entries(paramsString),
    queryFn: () => fetcher<LogsResponse>(`/api/v1/logs?${paramsString}`)
  })
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: logsKeys.entries(paramsString) })
  return { ...query, refresh }
}

export function useLogDates() {
  return useQuery({
    queryKey: logsKeys.dates,
    queryFn: () => fetcher<DatesResponse>('/api/v1/logs/dates')
  })
}

export function useLogScopes(date: string) {
  return useQuery({
    queryKey: logsKeys.scopes(date),
    queryFn: () => fetcher<ScopesResponse>(`/api/v1/logs/scopes?date=${date}`)
  })
}
```

`LogsResponse`/`DatesResponse`/`ScopesResponse` almost certainly aren't actually in
`services/analytics.ts` (that file's content is known from this plan's own exploration and doesn't
declare them) — find their real source first (`grep -rn "interface LogsResponse\|type LogsResponse"
src/renderer`) and fix the import in this step before moving on; do not guess the path.

- [ ] **Step 2: Migrate `logger.tsx`**

Replace the three `useSWR` lines with `useLogs(params.toString())`, `useLogDates()`,
`useLogScopes(date)`; replace the bare `mutate` from `useLogs`'s destructure with its returned
`refresh` (the `handleClearAll` function's `mutate()` call becomes `refresh()`).

- [ ] **Step 3: Gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/hooks/use-logs.ts src/renderer/components/settings/settings-form/logger.tsx
git commit -m "feat(query): migrate the Logger settings page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Settings → Chat Audit

**Files:**

- Create: `src/renderer/hooks/use-analytics.ts`
- Modify: `src/renderer/components/settings/settings-form/chat-audit.tsx`

**Interfaces:**

- Produces: `analyticsKeys = { status: ['analytics', 'status'] as const }`, `useAnalyticsStatus()`.

- [ ] **Step 1: Implement the hook**

```typescript
import { fetcher } from '@actovia/shared/utils/http'
// src/renderer/hooks/use-analytics.ts
import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  ANALYTICS_STATUS_KEY,
  type AnalyticsStatus
} from '@/services/analytics'

export const analyticsKeys = { status: ['analytics', 'status'] as const }

export function useAnalyticsStatus() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: analyticsKeys.status,
    queryFn: () => fetcher<AnalyticsStatus>(ANALYTICS_STATUS_KEY)
  })
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: analyticsKeys.status })
  return { ...query, refresh }
}
```

- [ ] **Step 2: Migrate `chat-audit.tsx`**

Replace:

```typescript
const {
  data: status,
  isLoading: statusLoading,
  refresh: refreshStatus
} = useAnalyticsStatus()
```

for the original's `mutate: refreshStatus` — every call site of `refreshStatus()` elsewhere in this
file (check `grep -n "refreshStatus" src/renderer/components/settings/settings-form/chat-audit.tsx`)
keeps working unchanged since it's still a zero-argument function with the same effect.

- [ ] **Step 3: Gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/hooks/use-analytics.ts src/renderer/components/settings/settings-form/chat-audit.tsx
git commit -m "feat(query): migrate the Chat Audit status query

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: MCP domain (servers + composer tools)

**Files:**

- Modify: `src/renderer/services/mcp-service.ts` (already pure, no change needed)
- Create: `src/renderer/hooks/use-mcp.ts`
- Modify: `src/renderer/components/settings/settings-form/mcp-servers.tsx`
- Modify: `src/renderer/components/composer-tools.tsx`

**Interfaces:**

- Produces: `mcpKeys = { servers: ['mcp', 'servers'] as const, tools: ['mcp', 'tools'] as const }`,
  `useMcpServers()`, `useMcpTools()` (both files read `mcpKeys.tools` — the same query, shared cache
  entry, exactly like the two components sharing one SWR key today), `useMcpServerMutations()`
  (create/update/delete, all invalidating both keys since a server change can change its tools).

- [ ] **Step 1: Implement the hook**

```typescript
// Match the McpToolsGroup type mcp-servers.tsx/composer-tools.tsx already
// import today (`grep -n "McpToolsGroup" src/renderer/components/settings/settings-form/mcp-servers.tsx`)
import type { McpToolsGroup } from '@actovia/shared/types/mcp'
// src/renderer/hooks/use-mcp.ts
import { fetcher } from '@actovia/shared/utils/http'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createMcpServerApi,
  deleteMcpServerApi,
  getMcpServers,
  updateMcpServerApi,
  type McpServerItem
} from '@/services/mcp-service'

export const mcpKeys = {
  servers: ['mcp', 'servers'] as const,
  tools: ['mcp', 'tools'] as const
}

export function useMcpServers() {
  return useQuery({ queryKey: mcpKeys.servers, queryFn: getMcpServers })
}

export function useMcpTools() {
  return useQuery({
    queryKey: mcpKeys.tools,
    queryFn: () => fetcher<{ tools: McpToolsGroup[] }>('/api/v1/mcp/tools')
  })
}

function useInvalidateMcp() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: mcpKeys.servers })
    queryClient.invalidateQueries({ queryKey: mcpKeys.tools })
  }
}

export function useCreateMcpServer() {
  const invalidate = useInvalidateMcp()
  return useMutation({ mutationFn: createMcpServerApi, onSuccess: invalidate })
}

export function useUpdateMcpServer() {
  const invalidate = useInvalidateMcp()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<McpServerItem> }) =>
      updateMcpServerApi(id, data),
    onSuccess: invalidate
  })
}

export function useDeleteMcpServer() {
  const invalidate = useInvalidateMcp()
  return useMutation({ mutationFn: deleteMcpServerApi, onSuccess: invalidate })
}
```

If `@actovia/shared/types/mcp` isn't the real path for `McpToolsGroup`, correct it per the grep in
the comment before finishing this step — don't guess.

- [ ] **Step 2: Migrate `mcp-servers.tsx`**

Read the file's create/update/delete handlers in full first (they're not shown in this plan's
exploration beyond the query lines) to preserve their exact control flow; replace the two `useSWR`
lines with `useMcpServers()`/`useMcpTools()`, and replace direct `fetcher()` calls to the
create/update/delete endpoints (if any exist inline rather than through a service function — check
`grep -n "fetcher(" src/renderer/components/settings/settings-form/mcp-servers.tsx`) with the new
mutation hooks. The `refresh` callback (`await mutate(); await mutateTools();`) becomes a call to
the same `useInvalidateMcp` pattern — either export it from `use-mcp.ts` for direct use, or simply
call `useMcpServers()`'s and `useMcpTools()`'s own refetch via `queryClient.invalidateQueries`
inline if a manual refresh button still needs one after a save.

- [ ] **Step 3: Migrate `composer-tools.tsx`**

```typescript
// components/composer-tools.tsx — replace the useSWR line:
const { data } = useMcpTools()
```

- [ ] **Step 4: Verify the shared cache**

Write a quick manual check (not a committed test, since this is exercised by both components'
existing behavior): confirm `mcpKeys.tools` really is the same array reference/value in both files
by grepping both after the edit — `grep -n "useMcpTools" src/renderer/components/composer-tools.tsx
src/renderer/components/settings/settings-form/mcp-servers.tsx` should show identical usage, proving
they share the query, the same guarantee SWR's single string key gave for free.

- [ ] **Step 5: Gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/hooks/use-mcp.ts src/renderer/components/settings/settings-form/mcp-servers.tsx \
  src/renderer/components/composer-tools.tsx
git commit -m "feat(query): migrate the MCP servers & tools domain

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Discover feed

**Files:**

- Modify: `src/renderer/hooks/use-discover-feed.ts`
- Test: `tests/unit/renderer/hooks/use-discover-feed.test.ts` (create if it doesn't exist; check first)

**Interfaces:**

- Produces: `discoverKeys = { feed: ['discover', 'feed'] as const }`; the exported `useDiscoverFeed`
  function's signature (`(enabled: boolean) => { feed, mutate }`) is preserved exactly — this hook
  has multiple existing consumers (`messages.tsx`, `DiscoverFeed`, per its own docstring) that must
  not need to change.

- [ ] **Step 1: Check for an existing test**

Run: `ls tests/unit/renderer/hooks/use-discover-feed.test.ts` — read and preserve its assertions if
present, same approach as Task 3's Step 1.

- [ ] **Step 2: Rewrite the hook, preserving its return shape**

```typescript
// src/renderer/hooks/use-discover-feed.ts
import type { DiscoverFeedDto } from '@actovia/shared/types/discover'
import { fetcher } from '@actovia/shared/utils/http'
import { useQuery, useQueryClient } from '@tanstack/react-query'

// While a refresh is running, poll so the freshly generated groups appear
// without a manual reload.
const REFRESHING_POLL_MS = 3000

export const discoverKeys = { feed: ['discover', 'feed'] as const }

/**
 * Shared read of the Home Discover feed. `messages.tsx` uses it to decide
 * whether the landing screen has feed content to show (which drives the
 * greeting layout), and `DiscoverFeed` uses it to render the feed itself —
 * one query key, so both consumers share a single request and cache entry.
 *
 * Pass `enabled: false` to stand the hook down entirely (no request) when the
 * user hasn't opted into Discover or the route isn't the true home.
 */
export function useDiscoverFeed(enabled: boolean) {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: discoverKeys.feed,
    queryFn: () => fetcher<DiscoverFeedDto>('/api/v1/discover'),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.status === 'refreshing' ? REFRESHING_POLL_MS : false
  })

  const mutate = () =>
    queryClient.invalidateQueries({ queryKey: discoverKeys.feed })

  return { feed: data ?? null, mutate }
}
```

Check the exact `refetchInterval` callback signature for the installed `@tanstack/react-query`
version (`grep -n '"@tanstack/react-query"' package.json` for the version, then check its types —
v5's `refetchInterval` function receives the `Query` object, with `query.state.data` as shown; an
earlier v4-style signature receiving `(data, query)` directly would need `data?.status` instead —
confirm against the actually-installed version rather than assuming v5's shape blindly).

- [ ] **Step 3: Run the existing/new test, confirm it passes**

Run: `bunx vitest run tests/unit/renderer/hooks/use-discover-feed.test.ts`
Expected: PASS (write the test first per TDD if none existed, following Task 4's test pattern:
mock `fetcher`, assert `enabled: false` makes no request, assert the poll interval switches on/off
based on `status`).

- [ ] **Step 4: Gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/hooks/use-discover-feed.ts tests/unit/renderer/hooks/use-discover-feed.test.ts
git commit -m "feat(query): migrate useDiscoverFeed, preserving its polling behavior

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 14: Installed apps (Computer Use allowlist)

**Files:**

- Modify: `src/renderer/hooks/use-installed-apps.ts`
- Test: `tests/unit/renderer/hooks/use-installed-apps.test.ts` (create if none exists; check first)

**Interfaces:**

- Produces: `installedAppsKeys = { all: ['installed-apps'] as const }`; `useInstalledApps(enabled:
  boolean)` return shape (`{ apps, isLoading }`) preserved exactly.

- [ ] **Step 1: Check for an existing test, then rewrite**

```typescript
// src/renderer/hooks/use-installed-apps.ts
import type { InstalledApp } from '@actovia/shared/types/computer-use'
import { useQuery } from '@tanstack/react-query'

import { getInstalledApps } from '@/services/computer-use'

export const installedAppsKeys = { all: ['installed-apps'] as const }

/**
 * Installed applications for the Computer Use allowlist picker. Pass
 * `enabled: false` until the picker is actually opened — the underlying
 * `list-apps` call scans the app directories and renders every icon.
 */
export function useInstalledApps(enabled: boolean) {
  const { data, isLoading } = useQuery({
    queryKey: installedAppsKeys.all,
    queryFn: getInstalledApps,
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 60_000
  })
  return { apps: data?.apps ?? [], isLoading: enabled && isLoading }
}
```

`staleTime: 60_000` is React Query's nearest equivalent to SWR's `dedupingInterval: 60_000` — both
mean "don't re-fetch for a minute if the data is already there," though they're not byte-identical
semantics (`dedupingInterval` dedupes concurrent/rapid calls; `staleTime` marks data fresh for that
window even across remounts) — close enough for an allowlist picker's icon list, note it and move
on rather than trying to replicate SWR's exact dedup window.

- [ ] **Step 2: Run the test, confirm it passes**

Run: `bunx vitest run tests/unit/renderer/hooks/use-installed-apps.test.ts`
Expected: PASS

- [ ] **Step 3: Gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/hooks/use-installed-apps.ts tests/unit/renderer/hooks/use-installed-apps.test.ts
git commit -m "feat(query): migrate useInstalledApps

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 15: Skills Market domain

The biggest single domain — 4 components + the services file, sharing `INSTALLED_SKILLS_KEY` and
several parameterized keys (registry page, search, detail, audit). Do this as one task since the
components interlock (installing a skill on the detail page must invalidate the installed-list
query the sidebar and the market's own "already installed" badge both read).

**Files:**

- Modify: `src/renderer/services/skills.ts` (strip `mutate` calls, keep the key-builder functions —
  they become query-key _inputs_, not SWR keys)
- Create/extend: `src/renderer/hooks/use-installed-skills.ts` (Task 7 created the read-only version;
  this task adds the mutations)
- Create: `src/renderer/hooks/use-skills-registry.ts`
- Modify: `src/renderer/components/skills-market/index.tsx`
- Modify: `src/renderer/components/skills-market/leaderboard.tsx`
- Modify: `src/renderer/components/skills-market/skill-detail.tsx`
- Modify: `src/renderer/components/skills-market/installed-list.tsx`

**Interfaces:**

- Consumes: `useInstalledSkills` / `installedSkillsKeys` from Task 7 — extended here, not
  redefined.
- Produces: `skillsKeys = { registry: (view, page) => [...], search: (query) => [...], detail: (id)
  => [...], audit: (id) => [...] }`; `useSkillsRegistry(view, page)`, `useSkillsInfiniteRegistry
  (view)` (the `useSWRInfinite` replacement, via `useInfiniteQuery`), `useSkillsSearch(query)`,
  `useSkillDetail(id)`, `useSkillAudit(id)`, `useInstallSkill()`, `useUninstallSkill()`,
  `useToggleSkill()`.

- [ ] **Step 1: Strip side effects from `services/skills.ts`**

```typescript
// src/renderer/services/skills.ts
import type {
  InstalledSkill,
  SkillAuditResponse,
  SkillDetail,
  SkillListResponse,
  SkillSearchResponse,
  SkillsView
} from '@actovia/shared/types/skills'
import { fetcher } from '@actovia/shared/utils/http'

const BASE = '/api/v1/skills'

export const REGISTRY_PAGE_SIZE = 24
export const INSTALLED_SKILLS_URL = `${BASE}/installed`

export function registryUrl(view: SkillsView, page: number): string {
  return `${BASE}/registry?view=${view}&page=${page}&per_page=${REGISTRY_PAGE_SIZE}`
}

export function searchUrl(query: string): string {
  return `${BASE}/search?q=${encodeURIComponent(query)}&limit=40`
}

export function detailUrl(id: string): string {
  return `${BASE}/detail?id=${encodeURIComponent(id)}`
}

export function auditUrl(id: string): string {
  return `${BASE}/audit?id=${encodeURIComponent(id)}`
}

export type { InstalledSkill, SkillAuditResponse, SkillDetail }
export type { SkillListResponse, SkillSearchResponse }

export const installSkill = (id: string) =>
  fetcher<InstalledSkill>(`${BASE}/install`, { method: 'POST', body: { id } })

export const uninstallSkill = (slug: string) =>
  fetcher<{ success: true }>(`${BASE}/${encodeURIComponent(slug)}`, {
    method: 'DELETE'
  })

export const toggleSkill = (slug: string, isActive: boolean) =>
  fetcher<{ success: true }>(`${BASE}/${encodeURIComponent(slug)}/toggle`, {
    method: 'PATCH',
    body: { isActive }
  })

/** The @actovia-ai/cli equivalent of the Install button, shown on every detail page. */
export function cliInstallCommand(id: string): string {
  return `actovia skills install ${id}`
}
```

(Renamed `registryKey`/`searchKey`/`detailKey`/`auditKey` to `registryUrl`/etc. and
`INSTALLED_SKILLS_KEY` to `INSTALLED_SKILLS_URL` — they build request URLs, not React Query keys;
keeping the old names would read as if they _were_ query keys, which is exactly the confusion this
migration is meant to remove. Update every import site in this task's later steps accordingly.)

- [ ] **Step 2: Extend `hooks/use-installed-skills.ts` with mutations**

```typescript
// src/renderer/hooks/use-installed-skills.ts
import type { InstalledSkill } from '@actovia/shared/types/skills'
import { fetcher } from '@actovia/shared/utils/http'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  installSkill,
  INSTALLED_SKILLS_URL,
  toggleSkill,
  uninstallSkill
} from '@/services/skills'

export const installedSkillsKeys = { all: ['installed-skills'] as const }

export function useInstalledSkills() {
  return useQuery({
    queryKey: installedSkillsKeys.all,
    queryFn: () => fetcher<InstalledSkill[]>(INSTALLED_SKILLS_URL)
  })
}

export function useInstallSkill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: installSkill,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: installedSkillsKeys.all })
  })
}

export function useUninstallSkill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: uninstallSkill,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: installedSkillsKeys.all })
  })
}

export function useToggleSkill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, isActive }: { slug: string; isActive: boolean }) =>
      toggleSkill(slug, isActive),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: installedSkillsKeys.all })
  })
}
```

- [ ] **Step 3: Write the failing test for the registry/search/infinite hooks**

```typescript
// tests/unit/renderer/hooks/use-skills-registry.test.ts
// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../../helpers/query-test-utils'

const fetcher = vi.fn()
vi.mock('@actovia/shared/utils/http', () => ({
  fetcher: (...args: unknown[]) => fetcher(...args)
}))

const { skillsKeys, useSkillsInfiniteRegistry } =
  await import('@/hooks/use-skills-registry')

function Probe<T>({
  hook,
  onReady
}: {
  hook: () => T
  onReady: (v: T) => void
}) {
  onReady(hook())
  return null
}

describe('useSkillsInfiniteRegistry', () => {
  afterEach(() => fetcher.mockClear())

  it('fetches page 0 first, and fetchNextPage advances the page index', async () => {
    fetcher.mockImplementation((url: string) =>
      Promise.resolve({
        data: [{ id: url.includes('page=0') ? 'a' : 'b' }],
        pagination: { total: 2, hasMore: url.includes('page=0') }
      })
    )
    let latest: ReturnType<typeof useSkillsInfiniteRegistry> | undefined
    await renderWithQueryClient(
      createElement(Probe, {
        hook: () => useSkillsInfiniteRegistry('all-time'),
        onReady: (v) => (latest = v)
      })
    )
    // Allow the initial query to settle.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('page=0'))
  })
})

describe('skillsKeys', () => {
  it('builds distinct, stable keys per view/page', () => {
    expect(skillsKeys.registry('all-time', 0)).toEqual([
      'skills',
      'registry',
      'all-time',
      0
    ])
    expect(skillsKeys.registry('trending', 1)).toEqual([
      'skills',
      'registry',
      'trending',
      1
    ])
    expect(skillsKeys.search('foo')).toEqual(['skills', 'search', 'foo'])
    expect(skillsKeys.detail('id-1')).toEqual(['skills', 'detail', 'id-1'])
    expect(skillsKeys.audit('id-1')).toEqual(['skills', 'audit', 'id-1'])
  })
})
```

- [ ] **Step 4: Run it, confirm it fails**

Run: `bunx vitest run tests/unit/renderer/hooks/use-skills-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `use-skills-registry.ts`**

```typescript
// src/renderer/hooks/use-skills-registry.ts
import type {
  SkillDetail,
  SkillAuditResponse,
  SkillListResponse,
  SkillSearchResponse,
  SkillsView
} from '@actovia/shared/types/skills'
import { fetcher } from '@actovia/shared/utils/http'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { auditUrl, detailUrl, registryUrl, searchUrl } from '@/services/skills'

export const skillsKeys = {
  registry: (view: SkillsView, page: number) =>
    ['skills', 'registry', view, page] as const,
  registryInfinite: (view: SkillsView) => ['skills', 'registry', view] as const,
  search: (query: string) => ['skills', 'search', query] as const,
  detail: (id: string) => ['skills', 'detail', id] as const,
  audit: (id: string) => ['skills', 'audit', id] as const
}

/** The registry's first page — used by the "All time (n)" tab total. */
export function useSkillsRegistryFirstPage(view: SkillsView) {
  return useQuery({
    queryKey: skillsKeys.registry(view, 0),
    queryFn: () => fetcher<SkillListResponse>(registryUrl(view, 0))
  })
}

/** The infinite-scrolling leaderboard list. */
export function useSkillsInfiniteRegistry(view: SkillsView) {
  return useInfiniteQuery({
    queryKey: skillsKeys.registryInfinite(view),
    queryFn: ({ pageParam }) =>
      fetcher<SkillListResponse>(registryUrl(view, pageParam)),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.pagination.hasMore ? allPages.length : undefined
  })
}

export function useSkillsSearch(query: string) {
  return useQuery({
    queryKey: skillsKeys.search(query),
    queryFn: () => fetcher<SkillSearchResponse>(searchUrl(query)),
    enabled: !!query
  })
}

export function useSkillDetail(id: string) {
  return useQuery({
    queryKey: skillsKeys.detail(id),
    queryFn: () => fetcher<SkillDetail>(detailUrl(id))
  })
}

export function useSkillAudit(id: string) {
  return useQuery({
    queryKey: skillsKeys.audit(id),
    queryFn: () => fetcher<SkillAuditResponse | null>(auditUrl(id))
  })
}
```

- [ ] **Step 6: Run the test again, confirm it passes**

Run: `bunx vitest run tests/unit/renderer/hooks/use-skills-registry.test.ts`
Expected: PASS

- [ ] **Step 7: Migrate `skills-market/index.tsx`**

Replace `useSWR<InstalledSkill[]>(INSTALLED_SKILLS_KEY)` with `useInstalledSkills()` (from Task 7's
file, now extended); replace `useSWR<SkillListResponse>(registryKey('all-time', 0))` with
`useSkillsRegistryFirstPage('all-time')`. Update the import of `INSTALLED_SKILLS_KEY, registryKey`
from `@/services/skills` — those names no longer exist post-Step-1's rename; import the new hooks
from `@/hooks/use-installed-skills` and `@/hooks/use-skills-registry` instead.

- [ ] **Step 8: Migrate `skills-market/leaderboard.tsx`**

Two hooks in this file: `SearchResults` uses `useSWR<SkillSearchResponse>(searchKey(query))` →
`useSkillsSearch(query)` (its `error`/`isLoading`/retry-via-`mutate()` UI: replace `mutate()` in the
`onRetry` callback with `queryClient.invalidateQueries({ queryKey: skillsKeys.search(query) })`, or
simpler, the query object's own `refetch()` — React Query's `useQuery` return includes `refetch`
directly, no `useQueryClient()` needed for a single query's own retry). `RegistryLeaderboard` uses
`useSWRInfinite<SkillListResponse>((index) => registryKey(view, index), { revalidateFirstPage:
false })` → `useSkillsInfiniteRegistry(view)`; its `size`/`setSize` become `data?.pages.length` /
`fetchNextPage`, `isValidating` becomes `isFetchingNextPage`, and its `mutate()` retry becomes
`refetch()`. Read the full file (`sed -n 1,320p
src/renderer/components/skills-market/leaderboard.tsx`) before this step — the `hasMore`/
`loadingMore` derivations and the "load more" trigger (likely an intersection observer or a button)
need their variable names updated to match `useInfiniteQuery`'s return shape exactly.

- [ ] **Step 9: Migrate `skills-market/skill-detail.tsx`**

Replace the three `useSWR` lines with `useSkillDetail(item.id)`, `useSkillAudit(item.id)`,
`useInstalledSkills()`. The install/uninstall/toggle action handlers (read the file's full install
button logic first) switch from calling `installSkill(...)` + `mutate()` directly to
`useInstallSkill().mutateAsync(...)` (invalidation is automatic via the hook's `onSuccess`).

- [ ] **Step 10: Migrate `skills-market/installed-list.tsx`**

Replace `useSWR<InstalledSkill[]>(INSTALLED_SKILLS_KEY)` with `useInstalledSkills()`; replace the
`toggleSkill`/`uninstallSkill` direct calls in `handleToggle` (and the uninstall confirm handler,
read the rest of the file for it) with `useToggleSkill().mutateAsync(...)` /
`useUninstallSkill().mutateAsync(...)`.

- [ ] **Step 11: Verify no stale references**

Run: `grep -rn "from '@/services/skills'" src/renderer/components/skills-market`
Expected: only type-only imports remain (`SkillDetail`, `InstalledSkill`, etc.), no function
imports — every function now comes through the two hook files.

- [ ] **Step 12: Full gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/services/skills.ts src/renderer/hooks/use-installed-skills.ts \
  src/renderer/hooks/use-skills-registry.ts src/renderer/components/skills-market \
  tests/unit/renderer/hooks/use-skills-registry.test.ts
git commit -m "feat(query): migrate the Skills Market domain

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 16: Deep Research domain

**Files:**

- Modify: `src/renderer/services/deep-research.ts` (already pure, no change)
- Create: `src/renderer/hooks/use-deep-research.ts`
- Modify: `src/renderer/components/deep-research/index.tsx`
- Modify: `src/renderer/components/calling-tools/deep-research/deep-research-card.tsx`

**Interfaces:**

- Produces: `deepResearchKeys = { result: (id: string) => ['deep-research', 'result', id] as
  const }`, `useDeepResearchResult(id: string | undefined)` (both components read the same key for
  the same `id` — sharing a cache entry, matching today's behavior where both independently `useSWR`
  the identical URL and SWR dedupes it for them).

- [ ] **Step 1: Implement the hook**

```typescript
// src/renderer/hooks/use-deep-research.ts
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { fetchDeepResearchResult } from '@/services/deep-research'
import { DeepResearch } from '@/types/db'

export const deepResearchKeys = {
  result: (id: string) => ['deep-research', 'result', id] as const
}

export function useDeepResearchResult(id: string | undefined) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: deepResearchKeys.result(id ?? 'none'),
    queryFn: () => fetchDeepResearchResult(id!),
    enabled: !!id
  })
  const refresh = () =>
    id
      ? queryClient.invalidateQueries({ queryKey: deepResearchKeys.result(id) })
      : undefined
  return { ...query, refresh }
}
```

`services/deep-research.ts`'s `fetchDeepResearchResult`/`fetchDeepResearchMessages` return
`Promise<DeepResearch>`/`Promise<DeepResearchMessage[]>` already — confirm the type import path
(`@/types/db`) matches what `deep-research/index.tsx` currently imports (it does, per the file
already read in this plan's exploration).

- [ ] **Step 2: Migrate `deep-research/index.tsx`**

Replace:

```typescript
const { data: deepResearchResult, refresh: mutateResult } =
  useDeepResearchResult(activeDeepResearchId)
```

Every later call site of `mutateResult()` in this file (check `grep -n "mutateResult"
src/renderer/components/deep-research/index.tsx` — the design spec's own exploration found one, in
the SSE `onmessage` handler's `CompleteDeepResearch` branch) keeps working unchanged, since
`refresh` is still a zero-arg function with the same effect. Remove the `useSWR` import.

- [ ] **Step 3: Migrate `deep-research-card.tsx`**

```typescript
// components/calling-tools/deep-research/deep-research-card.tsx
const { data: deepResearchResult } = useDeepResearchResult(toolResult.id)
```

- [ ] **Step 4: Gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/hooks/use-deep-research.ts src/renderer/components/deep-research/index.tsx \
  src/renderer/components/calling-tools/deep-research/deep-research-card.tsx
git commit -m "feat(query): migrate the Deep Research result query

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 17: Remove SWR

**Files:**

- Modify: `src/renderer/main.tsx` (drop `SWRConfig`)
- Modify: `package.json`, `bun.lock`

**Interfaces:**

- Consumes: every hook/component from Tasks 3–16 — this task is only safe once all 22 call sites
  are migrated.

- [ ] **Step 1: Verify nothing references `swr` anymore**

Run: `grep -rln "from 'swr'\|from \"swr\"" src/renderer`
Expected: no output. If anything appears, that call site was missed by an earlier task — go back
and migrate it before continuing (do not remove the package while something still imports it).

- [ ] **Step 2: Remove `SWRConfig` from `main.tsx`**

```typescript
// src/renderer/main.tsx
import '@/assets/stylesheets/globals.css'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Provider } from 'jotai'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router'

import 'react-medium-image-zoom/dist/styles.css'
import { I18nProvider } from '@/components/i18n-provider'
import { LockScreen } from '@/components/lock/lock-screen'
import { ThemeProvider } from '@/components/theme-provider'
import { ToneBridge } from '@/components/tone-bridge'
import { useLock } from '@/hooks/use-lock'
import { i18nReady } from '@/lib/i18n'
import { queryClient } from '@/lib/query-client'
import { bootTone } from '@/lib/tone'
import { router } from '@/routes'

bootTone()

function AppRoot() {
  const { status, refresh, locked } = useLock()

  if (status === null) return null
  if (locked) return <LockScreen status={status} onUnlocked={refresh} />
  return <RouterProvider router={router} />
}

void i18nReady.finally(() => {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <QueryClientProvider client={queryClient}>
      <Provider>
        <ThemeProvider>
          <I18nProvider>
            <ToneBridge />
            <AppRoot />
          </I18nProvider>
        </ThemeProvider>
      </Provider>
      {import.meta.env.DEV && <ReactQueryDevtools buttonPosition="bottom-left" />}
    </QueryClientProvider>
  )
})
```

(`fetcher` is no longer imported here — `SWRConfig`'s `value={{ fetcher }}` was its only use in this
file; every query now calls `fetcher` itself, imported where needed.)

- [ ] **Step 3: Remove the dependency**

```bash
bun remove swr
```

- [ ] **Step 4: Full gate**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
```

Expected: PASS — this is the first point where a leftover `useSWR` reference anywhere in the tree
would fail typecheck (the package is gone), confirming Step 1's grep was complete.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/main.tsx package.json bun.lock
git commit -m "chore: remove swr — everything is on react-query now

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Full-suite confirmation**

Run: `bun run test`
Expected: every test file passes, including every hook test written across Tasks 1–16.

---

## Self-Review Notes

**Spec coverage:** §3 (services pure, hooks-only shape) — every task strips service side effects
and routes components through a hook. §4 (query key factories) — every domain task defines its own.
§5 (global error surface) — Task 1. §6 (success toasts in the hook, not global) — every mutation
hook's `onSuccess`. §7 (migration order) — Tasks 3→4→(5,6)→(7–16) follow the spec's
foundation-then-hot-path-then-everything-else order, with the project domain (Task 5) and search
(Task 6) inserted between the spec's task 2 and task 3/4 since they're small and unblock nothing
else waiting on them. §8 (testing) — every new hook has a test; `messages-rerender.test.ts`/
`use-chat.test.ts` explicitly re-run in Task 4. §9 (risks) — the `use-settings.ts` risk is Task 3's
entire point; the `meta.silent` escape hatch exists in Task 1 but only if a real case needs it
(matches the spec's own "leave it out rather than build it speculatively" — it's used nowhere in
this plan's own tasks, exactly as intended).

**Placeholder scan:** every step has real code or an exact `grep`/file-read instruction pointing at
what to preserve verbatim (used instead of retyping large unchanged JSX blocks, per Tasks 5 and 6 —
this is a deliberate choice for files whose unrelated 100+ lines don't need restating, not a
placeholder for logic this plan is responsible for).

**Type consistency:** `historyKeys`/`projectKeys`/`skillsKeys`/etc. are each defined exactly once
(Task 4/5/15 respectively) and every later reference imports that same export — checked every
cross-task usage of each. Task 5's project-scoped chats query deliberately does _not_ reuse
`historyKeys`: it's a filtered view (`?projectId=`), not the unfiltered list, so it gets its own
`projectKeys.chats(id)` rather than colliding with Task 4's key for a different query.
