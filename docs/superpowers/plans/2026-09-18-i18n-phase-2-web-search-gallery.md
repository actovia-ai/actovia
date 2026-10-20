# Web Search Gallery i18n Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the `webSearch` i18n namespace's deferred follow-up —
`image-lightbox.tsx`'s hardcoded strings. This closes out the namespace
entirely: `video-cards.tsx` (done in an earlier sub-plan),
`collect-gallery-images.ts`/`collect-gallery-videos.ts` (confirmed zero
UI strings, pure data utilities), and `image-gallery.tsx` (confirmed zero
UI strings — every visible bit is either an icon or a raw number) are all
already either done or out of scope.

**Architecture:** Extract `image-lightbox.tsx`'s 4 remaining strings into
a new `imageLightbox.*` section of the existing
`src/shared/i18n/locales/en/webSearch.json`. No `<Trans>` needed — all
plain prose, one with a numeric interpolation.

**Tech Stack:** React 19, react-i18next, i18next, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- **Pre-commit gate:** `pnpm format` → `pnpm lint` → `pnpm typecheck` →
  `pnpm i18n:check` → `pnpm test` must all pass before any commit.
- **English is the source catalog.** New keys go into
  `src/shared/i18n/locales/en/webSearch.json` only, alongside the
  existing `videoCard.views` key.
- **Component:** `image-lightbox.tsx` already uses
  `useTranslation('common')` for `t('action.close')` — becomes array
  form `useTranslation(['common', 'webSearch'])` (existing namespace
  first, new lookups prefixed `webSearch:`).
- **Working-tree note**: `image-gallery.tsx` and `image-lightbox.tsx`
  each carry one small, pre-existing, purely cosmetic uncommitted
  change from a concurrent session (an icon swap + spacing tweak in
  `image-gallery.tsx`; a loader-badge repositioning in
  `image-lightbox.tsx`) — neither touches any text string, so this
  plan's rewrite is built on top of both without reverting them.
  `image-gallery.tsx` itself needs NO changes (confirmed zero
  UI-text strings) and is not part of this plan's file list.
- **No tooling catches a stale/orphaned English catalog key** —
  manually grep/script-verify zero missing AND zero orphaned
  `imageLightbox.*` keys, and re-verify the pre-existing `videoCard.*`
  keys are still exactly matched too (this closes out the whole
  namespace).
- **Stray `node_modules/node_modules` symlink**: if any test run reports
  "Invalid hook call", run `ls -la node_modules/node_modules` first and
  `rm` it if present.
- **Known flaky test**: retry `pnpm test` once if the ONLY failure is
  the PGlite WASM teardown race (`RuntimeError: Aborted()`).
- **`pnpm format`/`oxfmt .` reformats the WHOLE repo**, including
  already-committed, unrelated files it happens to touch. After running
  the full gate, re-check `git status --porcelain` and `git checkout --`
  any file outside this plan's intended scope before staging.
- **`settings-form/memory.tsx` remains genuinely blocked** (real,
  in-progress logic changes from a concurrent session) — explicitly OUT
  OF SCOPE, do not touch.

---

### Task 1: Populate `imageLightbox.*`, rewrite `image-lightbox.tsx`

**Files:**

- Modify: `src/renderer/components/web-search/image-lightbox.tsx`
- Modify: `src/shared/i18n/locales/en/webSearch.json`
- Modify: `tests/unit/i18n/webSearch-namespace.test.ts`

**Interfaces:**

- Produces: `webSearch.imageLightbox.*` — consumed only within this file.

- [ ] **Step 1: Add the `imageLightbox` section to `webSearch.json`**

```json
{
  "videoCard": {
    "views": "{{count}} views"
  },
  "imageLightbox": {
    "imageUnavailable": "Image unavailable",
    "previewOnly": "Showing preview — full image unavailable",
    "previousImage": "Previous image",
    "nextImage": "Next image",
    "goToImage": "Go to image {{index}}"
  }
}
```

- [ ] **Step 2: Rewrite `image-lightbox.tsx`**

```tsx
// src/renderer/components/web-search/image-lightbox.tsx
import { TEST_IDS } from '@shared/constants/test-ids'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageOffIcon,
  LoaderIcon,
  XIcon
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { SourceFavicon } from '@/components/source-favicon'
import { cn } from '@/lib/utils'

import type { GalleryImage } from './collect-gallery-images'

// Dots only stay legible up to a handful; Brave caps image media at 8 anyway.
const MAX_DOTS = 8

/**
 * The stage image. External URLs load slowly, so we never blank out or leave
 * the previous frame on screen: the already-cached grid thumbnail paints
 * immediately (blurred, as a backdrop) and the full-resolution image fades in
 * over it once decoded. Keyed by `image.url` in the parent, so every step
 * remounts with fresh state.
 */
function LightboxImage({ image }: { image: GalleryImage }) {
  const { t } = useTranslation('webSearch')
  const [loaded, setLoaded] = useState(false)
  const [fullError, setFullError] = useState(false)
  const [thumbError, setThumbError] = useState(false)
  const hasThumb = Boolean(image.thumbnailUrl) && !thumbError

  if (fullError && !hasThumb) {
    return (
      <div className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
        <ImageOffIcon size={44} />
        <span className="text-sm">{t('imageLightbox.imageUnavailable')}</span>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
      {hasThumb && (!loaded || fullError) && (
        <img
          src={image.thumbnailUrl}
          alt={image.title}
          aria-hidden={!fullError}
          onError={() => setThumbError(true)}
          className={cn(
            'absolute max-h-full max-w-full object-contain transition-[filter,transform] duration-300',
            fullError ? '' : 'scale-105 blur-2xl brightness-95'
          )}
        />
      )}

      {!fullError && (
        <img
          src={image.url}
          alt={image.title}
          onLoad={() => setLoaded(true)}
          onError={() => setFullError(true)}
          className={cn(
            'relative max-h-full max-w-full object-contain transition-opacity duration-300',
            loaded ? 'opacity-100' : 'opacity-0'
          )}
        />
      )}

      {!loaded && !fullError && (
        <div className="bg-background/70 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full p-2 backdrop-blur">
          <LoaderIcon
            size={16}
            className="text-muted-foreground animate-spin"
          />
        </div>
      )}

      {fullError && hasThumb && (
        <div className="bg-background/70 text-muted-foreground absolute bottom-3 rounded-full px-3 py-1 text-xs backdrop-blur">
          {t('imageLightbox.previewOnly')}
        </div>
      )}
    </div>
  )
}

function NavButton({
  direction,
  onClick,
  testId
}: {
  direction: 'prev' | 'next'
  onClick: () => void
  testId: string
}) {
  const { t } = useTranslation('webSearch')
  const Icon = direction === 'prev' ? ChevronLeftIcon : ChevronRightIcon
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-label={
        direction === 'prev'
          ? t('imageLightbox.previousImage')
          : t('imageLightbox.nextImage')
      }
      className={cn(
        'bg-background/70 text-foreground ring-border hover:bg-background absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full shadow-md ring-1 backdrop-blur transition',
        direction === 'prev' ? 'left-4' : 'right-4'
      )}
    >
      <Icon size={22} />
    </button>
  )
}

export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose
}: {
  images: GalleryImage[]
  index: number
  onIndexChange: (next: number) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'webSearch'])
  const atStart = index <= 0
  const atEnd = index >= images.length - 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      else if (e.key === 'ArrowRight' && index < images.length - 1)
        onIndexChange(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, images.length, onIndexChange, onClose])

  // Warm the browser cache for the neighbouring frames so stepping through the
  // carousel is instant after the first visit.
  useEffect(() => {
    for (const i of [index + 1, index - 1]) {
      const neighbour = images[i]
      if (neighbour) {
        const img = new Image()
        img.src = neighbour.url
      }
    }
  }, [index, images])

  const current = images[index]
  if (!current) return null

  const closeOnBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return createPortal(
    <div
      className="bg-background/95 animate-in fade-in fixed inset-0 z-[100] flex flex-col backdrop-blur-xl duration-150"
      onClick={closeOnBackdrop}
    >
      <div className="flex h-12 shrink-0 items-center px-3">
        <button
          type="button"
          onClick={onClose}
          data-testid={TEST_IDS.gallery.lightboxClose}
          aria-label={t('action.close')}
          className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground flex size-8 items-center justify-center rounded-full transition"
        >
          <XIcon size={18} />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-20"
        onClick={closeOnBackdrop}
      >
        {!atStart && (
          <NavButton
            direction="prev"
            onClick={() => onIndexChange(index - 1)}
            testId={TEST_IDS.gallery.lightboxPrev}
          />
        )}

        <LightboxImage key={current.url} image={current} />

        {!atEnd && (
          <NavButton
            direction="next"
            onClick={() => onIndexChange(index + 1)}
            testId={TEST_IDS.gallery.lightboxNext}
          />
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-3 px-4 pt-2 pb-6">
        {images.length > 1 &&
          (images.length <= MAX_DOTS ? (
            <div className="flex items-center gap-1.5">
              {images.map((img, i) => (
                <button
                  key={img.url}
                  type="button"
                  onClick={() => onIndexChange(i)}
                  data-testid={TEST_IDS.gallery.lightboxDot}
                  aria-label={t('webSearch:imageLightbox.goToImage', {
                    index: i + 1
                  })}
                  aria-current={i === index || undefined}
                  className={cn(
                    'h-1.5 rounded-full transition-[width,background-color]',
                    i === index
                      ? 'bg-foreground w-5'
                      : 'bg-foreground/25 hover:bg-foreground/50 w-1.5'
                  )}
                />
              ))}
            </div>
          ) : (
            <div className="bg-foreground/8 text-muted-foreground rounded-full px-2.5 py-1 text-xs tabular-nums">
              {index + 1} / {images.length}
            </div>
          ))}

        <a
          href={current.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground flex max-w-2xl items-center gap-2 text-sm"
        >
          <SourceFavicon link={current.sourceUrl} className="size-4" />
          <span className="truncate">{current.title}</span>
        </a>
      </div>
    </div>,
    document.body
  )
}
```

Note `t('action.close')` keeps resolving unprefixed from `common`
(listed first in the array form) — unchanged from before.
`LightboxImage`/`NavButton` are separate function components each with
their own `useTranslation('webSearch')` call (they never used `common`,
so single-namespace form is correct there); the main `ImageLightbox`
uses the array form since it's the only one still needing
`common:action.close`.

- [ ] **Step 3: Append namespace tests**

Add to `tests/unit/i18n/webSearch-namespace.test.ts`, inside the
existing `describe('webSearch namespace (en)', ...)` block:

```ts
it('has the image lightbox keys', () => {
  expect(webSearch.imageLightbox).toMatchObject({
    imageUnavailable: 'Image unavailable',
    previewOnly: 'Showing preview — full image unavailable',
    previousImage: 'Previous image',
    nextImage: 'Next image',
    goToImage: 'Go to image {{index}}'
  })
})
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green (retry `pnpm test` once if only the known flaky
PGlite teardown fires).

Manually grep-verify zero missing/orphaned `webSearch.*` keys across
`image-lightbox.tsx` AND `video-cards.tsx` combined (the whole
namespace) vs. `webSearch.json`.

Re-check `git status --porcelain` and revert (`git checkout --`) any
file outside this task's scope that `pnpm format` incidentally touched
— in particular, confirm `settings-form/memory.tsx` and
`image-gallery.tsx` were NOT touched.

```bash
git add src/renderer/components/web-search/image-lightbox.tsx \
  src/shared/i18n/locales/en/webSearch.json \
  tests/unit/i18n/webSearch-namespace.test.ts
git commit -m "i18n: complete webSearch namespace (image lightbox)"
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
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-web-search-gallery.md
git commit -m "docs: add web-search-gallery i18n plan"
```

- [ ] **Step 4: Push**

```bash
git push
```
