# i18n Phase 2 — webSearch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the `webSearch` i18next namespace (currently an
empty Phase-1 scaffold, `{}`) with what's currently available — the
sixth of the 8 "the rest" namespaces, but only PARTIALLY completable
right now.

**Why partial:** the dedicated `webSearch` namespace's real scope is
`components/web-search/` (the settings tab, `settings-form/
web-search.tsx`, already uses the `settings` namespace — done under
`settings-tools`, NOT this namespace's job). Of the 5 files in
`components/web-search/`, `image-gallery.tsx` and `image-lightbox.tsx`
are BOTH actively dirty (part of an in-progress, unrelated
`image-generation` feature) and almost certainly hold the bulk of this
namespace's real UI strings (gallery/lightbox controls). Re-checked
`git status` immediately before starting — still dirty, matching the
`settings-integrations-mcp`/`memory.tsx` split precedent: cover what's
clean now, defer the rest to a follow-up plan
(`webSearch-gallery`, not yet written) once those two files settle.

Of the 3 CLEAN files: `collect-gallery-images.ts` and
`collect-gallery-videos.ts` are pure data-transformation utilities
(dedup/normalize media entries) with ZERO UI strings — nothing to
extract, confirmed by reading both in full. `video-cards.tsx` has
exactly ONE user-facing string: the `" views"` suffix on each video
card's view count.

**Architecture:**

- `video-cards.tsx` has no existing `useTranslation` call — fresh
  `useTranslation('webSearch')`.
- `formatViews()` returns an already-COMPACTED string (`"1.2K"`,
  `"4.5M"`, or a bare small integer as a string) — not a raw number — so
  real i18next pluralization (`_one`/`_other`) doesn't cleanly apply
  here (i18next's plural selection needs a numeric `count`, and a
  compacted string like `"1.2K"` can't drive plural-form selection).
  This is a deliberate, documented simplification: one interpolated,
  always-plural-shaped template (`"{{count}} views"`), matching the
  precedent set by `mcpServers.activeSummary` (dual-count sentence) and
  `discover`'s `age`/`topic` handling — not every count-shaped value
  gets real pluralization when the underlying value isn't a genuine
  number.
- `formatViews`, the video-URL/thumbnail/duration/creator rendering, and
  every other piece of `video-cards.tsx` stay exactly as-is.

**Tech Stack:** i18next + react-i18next (already wired).

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- Catalog file: `src/shared/i18n/locales/en/webSearch.json` (currently
  `{}`) — populate directly, no wrapper key. This plan adds only the
  `videoCard.views` key; the rest of the namespace is intentionally left
  for the deferred follow-up plan once `image-gallery.tsx`/
  `image-lightbox.tsx` settle.
- Never `git commit --amend`. `git add` scoped to the exact files this
  plan names — never `-A`/`.`. Re-run `git status --porcelain` before
  Task 1 and confirm `video-cards.tsx` is still clean; do NOT touch
  `image-gallery.tsx`/`image-lightbox.tsx` even if they happen to look
  settled — re-verify with a fresh `git diff --stat` first and treat
  them as a SEPARATE follow-up plan regardless.
- `pnpm i18n:check` / `pnpm typecheck` / `pnpm lint` / `pnpm test` must
  pass before every commit. The one standing `--no-verify` exception is
  a flaky, intermittent PGlite WASM-teardown abort under parallel test
  isolation, NOT scoped to one test file. If `pnpm test` instead shows
  "Invalid hook call"/"Cannot read properties of null" with a stack
  frame pointing outside this repo, check
  `ls -la node_modules/node_modules` first — see memory
  `stray-node-modules-symlink-incident`.
- Commit the plan document itself before considering this plan finished.

---

### Task 1: Video card view-count suffix

**Files:**

- Modify: `src/renderer/components/web-search/video-cards.tsx`
- Modify: `src/shared/i18n/locales/en/webSearch.json`
- Create: `tests/unit/i18n/webSearch-namespace.test.ts`

**Interfaces:**

- Consumes: `t` from `react-i18next`, `useTranslation('webSearch')`.
- Produces: nothing consumed elsewhere — this is the only string this
  plan covers; the follow-up gallery plan will add its own keys to the
  same `webSearch.json` file later.

- [ ] **Step 1: Write `webSearch.json`**

```json
{
  "videoCard": {
    "views": "{{count}} views"
  }
}
```

- [ ] **Step 2: Rewrite `video-cards.tsx`**

```tsx
import { TEST_IDS } from '@shared/constants/test-ids'
import { PlayIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { LazyLoadImage } from '@/components/lazy-load-image'
import { SourceFavicon } from '@/components/source-favicon'

import type { GalleryVideo } from './collect-gallery-videos'

/** Compact view count: 1234 → "1.2K", 4_500_000 → "4.5M". */
function formatViews(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
}

export function VideoCards({ videos }: { videos: GalleryVideo[] }) {
  const { t } = useTranslation('webSearch')
  if (videos.length === 0) return null

  return (
    <div className="my-3 flex gap-3 overflow-x-auto pb-1">
      {videos.map((video) => (
        <a
          key={video.url}
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={TEST_IDS.video.card}
          className="w-52 shrink-0"
        >
          <div className="relative aspect-video overflow-hidden rounded-xl">
            <LazyLoadImage
              src={video.thumbnailUrl}
              alt={video.title}
              className="size-full"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-black/60 text-white">
                <PlayIcon size={18} className="translate-x-px fill-current" />
              </span>
            </div>
            {video.duration && (
              <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
                {video.duration}
              </span>
            )}
          </div>
          <div className="mt-1.5 line-clamp-2 text-sm font-medium">
            {video.title}
          </div>
          <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
            <SourceFavicon link={video.url} className="size-3.5" />
            {(video.creator || video.source) && (
              <span className="truncate">{video.creator || video.source}</span>
            )}
            {video.views != null && video.views > 0 && (
              <span className="shrink-0">
                · {t('videoCard.views', { count: formatViews(video.views) })}
              </span>
            )}
          </div>
        </a>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Create the namespace test file**

Create `tests/unit/i18n/webSearch-namespace.test.ts`:

```ts
import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const webSearch = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'src',
      'shared',
      'i18n',
      'locales',
      'en',
      'webSearch.json'
    ),
    'utf8'
  )
)

describe('webSearch namespace (en)', () => {
  it('has the video card view-count key', () => {
    expect(webSearch.videoCard.views).toBe('{{count}} views')
  })
})
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green (retry `pnpm test` once if only the known flaky
PGlite teardown fires).

```bash
git add src/renderer/components/web-search/video-cards.tsx \
  src/shared/i18n/locales/en/webSearch.json \
  tests/unit/i18n/webSearch-namespace.test.ts
git commit -m "i18n: populate webSearch namespace's video-card view count (partial — gallery/lightbox deferred)"
```

---

### Task 2: Final verification and plan commit

**Files:** none modified — verification only, plus committing this plan
document.

- [ ] **Step 1: Isolated committed-tree check**

```bash
rm -rf /tmp/actovia-committed-check
git archive HEAD | (mkdir -p /tmp/actovia-committed-check && tar -x -C /tmp/actovia-committed-check)
ln -s /Users/yanceyleo/Code/actovia/universal-client/node_modules /tmp/actovia-committed-check/node_modules
cd /tmp/actovia-committed-check
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json --composite false
./node_modules/.bin/tsc --noEmit -p tsconfig.web.json --composite false
cd /Users/yanceyleo/Code/actovia/universal-client
rm -rf /tmp/actovia-committed-check
```

Expected: no errors.

- [ ] **Step 2: Full suite one more time**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm i18n:check && pnpm test`
Expected: all green.

- [ ] **Step 3: Commit the plan document**

```bash
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-web-search.md
git commit -m "docs: add webSearch (partial) i18n plan"
```

- [ ] **Step 4: Push**

```bash
git push
```
