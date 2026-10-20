# SWR → @tanstack/react-query — design

Status: design approved by the user in conversation (2026-09-23); spec written, not yet reviewed

## 1. Context and goal

`src/renderer/services/` (20 files) are mostly plain async functions wrapping `fetcher()`
(`@actovia/shared/utils/http`); 24 files call `useSWR` directly, some through a dedicated hook
(`hooks/use-settings.ts`), several inline in the component that needs the data
(`settings-form/devices.tsx`, `settings-form/providers/ollama.tsx`, …). Side effects — a `sileo`
toast, a `mutate(key)` cache-bust — live wherever the call happens: sometimes inside the service
function body (`services/chat.ts`'s `updateChat`/`deleteChat`), sometimes in the hook that wraps it
(`use-settings.ts`'s `updateSettings`), sometimes not at all. Nothing in this layer reports to the
structured log (`reportRendererError`) — a failed mutation is invisible to the Logger tab unless it
happens to become a truly unhandled rejection that `installGlobalErrorReporting()` catches by
accident.

**Goal:** move to `@tanstack/react-query`, and use the move to make the shape consistent —
one place components get server data from (a hook, never a raw `useSWR`/`useQuery` call inline),
one place a mutation's side effects live (not scattered across service bodies and hook bodies), and
real integration with the logger and sileo instead of ad hoc per-call handling.

## 2. Non-goals

- The live chat stream. `stream-manager.ts`'s own SSE reader doesn't use SWR today (confirmed: no
  reference to it anywhere in that file) and this migration doesn't touch it — `QueryClientProvider`
  replaces `SWRConfig` in `main.tsx` only; none of the three sub-apps (searchbar, quick-chat,
  artifacts) reference SWR today, so none need it.
- Changing what any endpoint returns, or any component's actual data shape.
- `@tanstack/react-query-devtools` is included (dev-only) as a default, not a decision point.

## 3. Services stay pure; hooks are the only new shape

`services/*.ts` get _purer_, not restructured: strip the `sileo`/`mutate` calls currently living
inside function bodies (`updateChat`, `deleteChat`, `useSettings`'s inline `updateSettings`),
leaving each a plain `(args) => fetcher(...)` — framework-agnostic, trivially unit-testable, no
React import. Every domain that has one or more `useSWR`/inline-fetch call sites today gets a
`hooks/use-<domain>.ts` (or extends an existing one) wrapping the service in `useQuery`/
`useMutation`; **no component imports `useQuery`/`useMutation` directly** — this is the rule that
closes the "some components inline `useSWR`" inconsistency, and the thing a reviewer checks for.

## 4. Query keys: typed factories, one per domain

Replacing SWR's string/tuple keys (often literally the request URL, e.g. `'/api/v1/history'`) with
React Query's array keys, via a factory per domain — the standard React Query pattern, colocated
with the domain's hook file:

```ts
// hooks/use-chat.ts (or a sibling use-chat.keys.ts if the file grows large)
export const chatKeys = {
  all: ['chat'] as const,
  history: () => [...chatKeys.all, 'history'] as const,
  detail: (id: string) => [...chatKeys.all, 'detail', id] as const
}
```

Invalidation becomes `queryClient.invalidateQueries({ queryKey: chatKeys.all })` instead of a
stringly-typed `mutate('/api/v1/history')` — the ~20 scattered call sites of the latter are exactly
what §3's cleanup removes, replaced by whatever mutation caused the change calling the right
factory's key.

## 5. One error surface: the `QueryClient`'s global callbacks

Configured once, where `QueryClientProvider` replaces `SWRConfig` in `main.tsx`:

- **`queryCache.onError`** (reads): `reportRendererError('query', error, { queryKey })`. No toast —
  a failed background read (a list that fails to refresh, a poll) shouldn't interrupt anyone, which
  matches SWR's current largely-silent-on-read-failure behavior.
- **`mutationCache.onError`** (writes): reports _and_ toasts by default — a mutation is always
  something the user explicitly asked for (save a setting, delete a chat), so silence would hide a
  real failure from the person who caused it. The toast's title/description come from the
  mutation's own `meta` (React Query mutations carry an optional `meta` object read back in the
  global handler — e.g. `meta: { errorTitle: t('settings:toast.saveFailed') }`), falling back to a
  generic "Something went wrong" if a mutation doesn't set one. A mutation that wants fully custom
  handling (a multi-step flow, a non-toast error UI) passes its own `onError` to `useMutation`,
  which runs _in addition to_ the global one — `mutationCache.onError` cannot be suppressed by a
  local `onError` in React Query's design, so a genuine opt-out (rare) needs a `meta: { silent:
  true }` flag the global handler checks first and returns early on.

This is a third, non-overlapping error-reporting surface alongside what already exists:
render-phase (`ErrorBoundary` → `reportRendererError('tool-card'/'markdown', …)`) and truly global
(`installGlobalErrorReporting()` → `window.onerror`/`unhandledrejection`). A query/mutation error is
always caught by React Query itself before it could become an unhandled rejection, so there's no
double-reporting between this and the global handler.

## 6. Success toasts

`sileo.success(...)` calls currently inline in a handful of services (`updateChat`, `deleteChat`)
move to the calling hook's `onSuccess`, alongside the matching `invalidateQueries` call — not into
the global `mutationCache`, since a success message is inherently mutation-specific copy ("Chat
deleted", "Settings saved") that doesn't generalize the way a generic error surface does.

## 7. Migration order

24 call sites across ~20 domains, roughly independent of each other — a natural task-per-domain
breakdown for the plan, ordered by risk/traffic rather than file order:

1. `main.tsx`: `SWRConfig` → `QueryClientProvider`, the global `onError` callbacks from §5.
2. `hooks/use-settings.ts` — the most-read hook in the app (every settings page), and the one with
   the trickiest existing behavior to preserve exactly: the optimistic local merge that avoids
   re-fetching (documented inline today — a `mutate()` revalidation would re-GET, bring back a
   bumped `updatedAt`, and loop through `useForm({ values: settings })`'s autosave). React Query's
   equivalent is `queryClient.setQueryData(settingsKeys.all, ...)` after the mutation instead of
   `invalidateQueries` — same shape, different API, same care needed.
3. `containers/chat-detail.tsx` / `components/chat.tsx` — the hot path CLAUDE.md's render-path rules
   protect; verify with `messages-rerender.test.ts` that nothing here regresses re-render behavior
   once migrated.
4. Everything else — `layouts/chat-layout/*`, `settings-form/*`, `skills-market/*`,
   `deep-research/*` — each a self-contained task once §3's shape is proven on the two above.

## 8. Testing

- `services/*.ts` need no new test infrastructure — still plain functions, same as today.
- Each `hooks/use-<domain>.ts` gets a render test in the existing pattern
  (`// @vitest-environment happy-dom`, `createRoot` + `act`, per CLAUDE.md's testing section) —
  query success, query error (reported, not toasted), mutation success (toast + cache update),
  mutation error (reported and toasted).
- `messages-rerender.test.ts` / `use-chat.test.ts` rerun unchanged after the chat-path migration —
  they're the existing guard against a regression here, not something this migration adds to.
- A small `test-utils` helper (a `QueryClientProvider` wrapped around `render`, matching the
  pattern every React Query codebase needs) is worth writing once, shared by every new hook test,
  rather than re-declared per file.

## 9. Risks and known limits

- `use-settings.ts`'s optimistic-update trick (§7, task 2) is the one place a naive migration could
  silently reintroduce the autosave loop it was written to prevent — call out explicitly in the
  plan's task for it, with a regression test asserting a single POST/GET pair, not a loop.
- `mutationCache.onError` always fires before or alongside a local `onError` (React Query does not
  let a local handler suppress the global one) — the `meta: { silent: true }` escape hatch in §5 is
  designed but unused until a real case needs it; if none turns up during the migration, leave it
  out rather than build it speculatively.
- 24 call sites is enough that a partial migration (some domains on React Query, some still on SWR)
  is a real intermediate state the plan will pass through — both libraries can coexist for the
  duration (different packages, no shared cache), so this is a sequencing question, not a
  correctness risk.
