# Philharmonic Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the AgentX feature to Philharmonic across both renderer and main process, then layer on the visual modernization defined in `docs/superpowers/specs/2026-06-02-agent-x-visual-modernization-design.md`.

**Architecture:** Two large bodies of work fused into one PR because they touch the same files. Phase 1 is an atomic rename (no visual change). Phases 2+ add the `--ph-*` token layer and re-skin each surface inside the new file paths. The page-switching IA stays the same. DB stays the same. API base flips from `/api/agent-x` to `/api/philharmonic`.

**Tech Stack:** React 19, Jotai, SWR, Tailwind (oklch + CSS vars), Vite, Electron, Drizzle (PGlite), Hono server, Vitest, oxlint + oxfmt.

---

## Scope Discovery (read before starting)

The rename touches **47 source files** and **156 token references** across:

- `src/renderer/components/agent-x/` (whole tree, 12 files)
- `src/renderer/layouts/agent-x-layout/`
- `src/renderer/containers/agent-x.tsx`
- `src/renderer/services/agent-x.ts`, `agent-x-chat.ts`
- `src/renderer/stores/agent-x.ts`, `agent-x-chat.ts`
- `src/renderer/hooks/use-conversation-stream.ts` (uses `/api/agent-x` URL)
- `src/renderer/layouts/chat-layout/nav-footer.tsx` (link to Philharmonic page)
- `src/renderer/routes/index.ts` (route registration)
- `src/shared/types/agent-x.ts` + `.test.ts`
- `src/main/lib/server/app.ts` (mounts `/api/agent-x` router)
- `src/main/lib/server/routes/agent-x.ts`, `agent-x-conversations.ts` (+test), `agent-x-crud.ts`, `agent-x-sse.ts`
- `src/main/lib/ai/agent-x/` (whole tree, 17 files including tests)
- `src/main/lib/db/agent-x-queries.ts`
- `src/main/lib/ai/mcp.ts` (references)
- `src/main/index.ts` (registers something from agent-x)

DB schema has **no** `agent_x` columns — tables are generic (`chat`, `message`, `agent`, etc.). No DB migrations needed.

API base path **does** flip: `/api/agent-x` → `/api/philharmonic`. Three renderer files + one main file reference the path.

---

## Phase 1 — Atomic Rename (no visual change)

### Task 1.1: Move all `agent-x` files to `philharmonic` paths

**Files (renderer):**

- Move: `src/renderer/components/agent-x/` → `src/renderer/components/philharmonic/`
- Move: `src/renderer/layouts/agent-x-layout/` → `src/renderer/layouts/philharmonic-layout/`
- Move: `src/renderer/containers/agent-x.tsx` → `src/renderer/containers/philharmonic.tsx`
- Move: `src/renderer/services/agent-x.ts` → `src/renderer/services/philharmonic.ts`
- Move: `src/renderer/services/agent-x-chat.ts` → `src/renderer/services/philharmonic-chat.ts`
- Move: `src/renderer/stores/agent-x.ts` → `src/renderer/stores/philharmonic.ts`
- Move: `src/renderer/stores/agent-x-chat.ts` → `src/renderer/stores/philharmonic-chat.ts`

**Files (main):**

- Move: `src/main/lib/server/routes/agent-x.ts` → `src/main/lib/server/routes/philharmonic.ts`
- Move: `src/main/lib/server/routes/agent-x-conversations.ts` → `src/main/lib/server/routes/philharmonic-conversations.ts` (+ `.test.ts`)
- Move: `src/main/lib/server/routes/agent-x-crud.ts` → `src/main/lib/server/routes/philharmonic-crud.ts`
- Move: `src/main/lib/server/routes/agent-x-sse.ts` → `src/main/lib/server/routes/philharmonic-sse.ts`
- Move: `src/main/lib/ai/agent-x/` → `src/main/lib/ai/philharmonic/` (whole tree)
- Move: `src/main/lib/db/agent-x-queries.ts` → `src/main/lib/db/philharmonic-queries.ts`

**Files (shared):**

- Move: `src/shared/types/agent-x.ts` → `src/shared/types/philharmonic.ts` (+ `.test.ts`)

- [ ] **Step 1: Use `git mv` for every move so git tracks the rename**

```bash
cd /Users/yanceyleo/Code/actovia/actovia

git mv src/renderer/components/agent-x src/renderer/components/philharmonic
git mv src/renderer/layouts/agent-x-layout src/renderer/layouts/philharmonic-layout
git mv src/renderer/containers/agent-x.tsx src/renderer/containers/philharmonic.tsx
git mv src/renderer/services/agent-x.ts src/renderer/services/philharmonic.ts
git mv src/renderer/services/agent-x-chat.ts src/renderer/services/philharmonic-chat.ts
git mv src/renderer/stores/agent-x.ts src/renderer/stores/philharmonic.ts
git mv src/renderer/stores/agent-x-chat.ts src/renderer/stores/philharmonic-chat.ts

git mv src/main/lib/server/routes/agent-x.ts src/main/lib/server/routes/philharmonic.ts
git mv src/main/lib/server/routes/agent-x-conversations.ts src/main/lib/server/routes/philharmonic-conversations.ts
git mv src/main/lib/server/routes/agent-x-conversations.test.ts src/main/lib/server/routes/philharmonic-conversations.test.ts
git mv src/main/lib/server/routes/agent-x-crud.ts src/main/lib/server/routes/philharmonic-crud.ts
git mv src/main/lib/server/routes/agent-x-sse.ts src/main/lib/server/routes/philharmonic-sse.ts
git mv src/main/lib/ai/agent-x src/main/lib/ai/philharmonic
git mv src/main/lib/db/agent-x-queries.ts src/main/lib/db/philharmonic-queries.ts

git mv src/shared/types/agent-x.ts src/shared/types/philharmonic.ts
git mv src/shared/types/agent-x.test.ts src/shared/types/philharmonic.test.ts
```

- [ ] **Step 2: Verify no `agent-x` directories remain under `src/`**

Run: `find src -type d -name "*agent-x*"`
Expected: empty output.

### Task 1.2: Update all import paths and identifiers

Identifier rename rules (apply across `**/*.ts` and `**/*.tsx`):

| Pattern                                     | Replace with                          |
| ------------------------------------------- | ------------------------------------- |
| `from '@/components/agent-x`                | `from '@/components/philharmonic`     |
| `from '@/layouts/agent-x-layout`            | `from '@/layouts/philharmonic-layout` |
| `from '@/containers/agent-x'`               | `from '@/containers/philharmonic'`    |
| `from '@/services/agent-x'`                 | `from '@/services/philharmonic'`      |
| `from '@/services/agent-x-chat'`            | `from '@/services/philharmonic-chat'` |
| `from '@/stores/agent-x'`                   | `from '@/stores/philharmonic'`        |
| `from '@/stores/agent-x-chat'`              | `from '@/stores/philharmonic-chat'`   |
| `from '@shared/types/agent-x'`              | `from '@shared/types/philharmonic'`   |
| `lib/ai/agent-x/` (relative imports)        | `lib/ai/philharmonic/`                |
| `lib/db/agent-x-queries`                    | `lib/db/philharmonic-queries`         |
| `lib/server/routes/agent-x`                 | `lib/server/routes/philharmonic`      |
| Identifier `AgentXContainer`                | `PhilharmonicContainer`               |
| Identifier `AgentXLayout`                   | `PhilharmonicLayout`                  |
| Identifier `AgentXPage`                     | `PhilharmonicPage`                    |
| Identifier `agentXRouter`                   | `philharmonicRouter`                  |
| Any other `AgentX*` identifier              | `Philharmonic*` (preserve casing)     |
| `'/api/agent-x'` literal                    | `'/api/philharmonic'`                 |
| User-facing `"AgentX"` / `'AgentX'` strings | `"Philharmonic"` / `'Philharmonic'`   |

- [ ] **Step 1: Run the bulk substitution with sed**

```bash
cd /Users/yanceyleo/Code/actovia/actovia

# Path rewrites — folder slug
git ls-files 'src/**/*.ts' 'src/**/*.tsx' | xargs sed -i '' \
  -e "s|@/components/agent-x|@/components/philharmonic|g" \
  -e "s|@/layouts/agent-x-layout|@/layouts/philharmonic-layout|g" \
  -e "s|@/containers/agent-x|@/containers/philharmonic|g" \
  -e "s|@/services/agent-x-chat|@/services/philharmonic-chat|g" \
  -e "s|@/services/agent-x|@/services/philharmonic|g" \
  -e "s|@/stores/agent-x-chat|@/stores/philharmonic-chat|g" \
  -e "s|@/stores/agent-x|@/stores/philharmonic|g" \
  -e "s|@shared/types/agent-x|@shared/types/philharmonic|g" \
  -e "s|lib/ai/agent-x/|lib/ai/philharmonic/|g" \
  -e "s|lib/ai/agent-x'|lib/ai/philharmonic'|g" \
  -e "s|lib/db/agent-x-queries|lib/db/philharmonic-queries|g" \
  -e "s|lib/server/routes/agent-x-conversations|lib/server/routes/philharmonic-conversations|g" \
  -e "s|lib/server/routes/agent-x-crud|lib/server/routes/philharmonic-crud|g" \
  -e "s|lib/server/routes/agent-x-sse|lib/server/routes/philharmonic-sse|g" \
  -e "s|lib/server/routes/agent-x|lib/server/routes/philharmonic|g" \
  -e "s|'/api/agent-x|'/api/philharmonic|g" \
  -e "s|\`/api/agent-x|\`/api/philharmonic|g" \
  -e "s|AgentXContainer|PhilharmonicContainer|g" \
  -e "s|AgentXLayout|PhilharmonicLayout|g" \
  -e "s|AgentXPage|PhilharmonicPage|g" \
  -e "s|agentXRouter|philharmonicRouter|g"
```

- [ ] **Step 2: Run typecheck, fix any remaining identifier mismatches**

Run: `pnpm typecheck`

If errors mention any other `AgentX*` identifier (`AgentXAvatar`, `AgentXSse`, etc.), grep for the full identifier and substitute:

```bash
grep -rn "AgentX[A-Za-z]" src --include="*.ts" --include="*.tsx"
```

For each remaining hit, apply: `sed -i '' "s/AgentXFooBar/PhilharmonicFooBar/g" <file>`. Re-run typecheck until green.

- [ ] **Step 3: Update user-facing strings**

```bash
grep -rn "AgentX\|Agent X" src --include="*.ts" --include="*.tsx" | grep -v "// " | grep -v "/\*"
```

For each hit that's inside a string literal (page title, toast, menu label, etc.), replace `AgentX` → `Philharmonic` and `Agent X` → `Philharmonic`. Leave code identifiers alone (the typecheck step already handled them).

- [ ] **Step 4: Update `chat-layout/nav-footer.tsx` Philharmonic link label**

Find the entry that opens the AgentX area (currently labeled "AgentX" or similar) in `src/renderer/layouts/chat-layout/nav-footer.tsx` and update its label to "Philharmonic".

- [ ] **Step 5: Run typecheck + tests + lint**

Run:

```bash
pnpm typecheck && pnpm test && pnpm lint
```

Expected: all green.

- [ ] **Step 6: Boot dev to smoke-check**

Run in background: `pnpm dev`

Wait ~15 seconds for the build, then check the dev log for compile errors. Kill the process. Expected: no errors.

### Task 1.3: Commit the rename

- [ ] **Step 1: Commit**

```bash
git add -A
git commit -m "refactor(philharmonic): rename AgentX feature to Philharmonic

Moves all agent-x folders/files to philharmonic, renames component/
type/router identifiers, updates import paths and the /api/agent-x
→ /api/philharmonic base URL across renderer and main. No behavior
change. DB schema is untouched (tables stay generic).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 2 — Design tokens + helpers

### Task 2.1: Add `--ph-*` token layer to globals.css

**Files:**

- Modify: `src/renderer/assets/stylesheets/globals.css` (append to existing `:root` and `.dark`)

- [ ] **Step 1: Append token block to `:root`**

Append at the end of the existing `:root { … }` block (before the `.dark { … }` block starts):

```css
/* Philharmonic design tokens — light */
--ph-canvas: #f5f3f0;
--ph-surface: #ffffff;
--ph-surface-sunken: #fbfaf7;
--ph-border: #f0eee9;
--ph-text: oklch(0.16 0.02 160);
--ph-text-muted: #888888;
--ph-primary: oklch(0.52 0.17 160);
--ph-primary-soft: oklch(0.92 0.04 160);
--ph-primary-faint: oklch(0.97 0.02 160);
--ph-success: #10b981;
--ph-warning: #f59e0b;
--ph-danger: oklch(0.58 0.25 27);

--ph-hue-lilac-fill: #e8d5ff;
--ph-hue-lilac-ring: #c8a8ff;
--ph-hue-mint-fill: #c2f0e2;
--ph-hue-mint-ring: #6dccab;
--ph-hue-peach-fill: #ffd7c2;
--ph-hue-peach-ring: #ff9b6c;
--ph-hue-sky-fill: #cfe8f3;
--ph-hue-sky-ring: #6fc3dd;
--ph-hue-rose-fill: #ffd2dc;
--ph-hue-rose-ring: #ff8aa5;
--ph-hue-honey-fill: #ffe9b5;
--ph-hue-honey-ring: #e8b948;
--ph-hue-periwinkle-fill: #d7e4ff;
--ph-hue-periwinkle-ring: #8aa8ff;
--ph-hue-sage-fill: #d5f3d1;
--ph-hue-sage-ring: #6fc76f;

--ph-radius-sm: 8px;
--ph-radius-md: 10px;
--ph-radius-lg: 14px;
--ph-radius-xl: 16px;
--ph-radius-2xl: 20px;

--ph-shadow-card:
  0 1px 2px rgba(20, 20, 30, 0.04), 0 6px 18px rgba(20, 20, 30, 0.05);
--ph-shadow-hover:
  0 2px 4px rgba(0, 0, 0, 0.05), 0 10px 24px rgba(0, 0, 0, 0.07);
--ph-shadow-drawer:
  0 0 0 1px rgba(0, 0, 0, 0.04), -16px 0 40px rgba(0, 0, 0, 0.08);
```

- [ ] **Step 2: Append corresponding dark overrides inside `.dark { … }`**

```css
/* Philharmonic design tokens — dark */
--ph-canvas: #15171c;
--ph-surface: #1d2027;
--ph-surface-sunken: #23262e;
--ph-border: #2a2e37;
--ph-text: #e6e8ec;
--ph-text-muted: #7d838f;
--ph-primary: oklch(0.55 0.17 160);
--ph-primary-soft: oklch(0.3 0.08 160);
--ph-primary-faint: oklch(0.22 0.05 160);
--ph-danger: oklch(0.62 0.25 27);

--ph-hue-lilac-fill: #3a2f5c;
--ph-hue-lilac-ring: #6b53b5;
--ph-hue-mint-fill: #1f4538;
--ph-hue-mint-ring: #3e8869;
--ph-hue-peach-fill: #4a2e22;
--ph-hue-peach-ring: #94583f;
--ph-hue-sky-fill: #1d3848;
--ph-hue-sky-ring: #3a6b89;
--ph-hue-rose-fill: #4a2832;
--ph-hue-rose-ring: #a24a63;
--ph-hue-honey-fill: #4a3d1a;
--ph-hue-honey-ring: #a88a2e;
--ph-hue-periwinkle-fill: #252e48;
--ph-hue-periwinkle-ring: #5a75b5;
--ph-hue-sage-fill: #1f3d1f;
--ph-hue-sage-ring: #3e783e;

--ph-shadow-card: 0 1px 2px rgba(0, 0, 0, 0.3), 0 6px 18px rgba(0, 0, 0, 0.25);
--ph-shadow-drawer:
  0 0 0 1px rgba(255, 255, 255, 0.04), -16px 0 40px rgba(0, 0, 0, 0.55);
```

- [ ] **Step 3: Add a `prefers-reduced-motion` block at the end of the file**

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 4: Run lint + format + dev to verify no breakage**

```bash
pnpm format && pnpm lint && pnpm typecheck
```

### Task 2.2: Create the hue helper module

**Files:**

- Create: `src/renderer/components/philharmonic/lib/hue.ts`
- Create: `src/renderer/components/philharmonic/lib/hue.test.ts`

- [ ] **Step 1: Write the failing test**

`src/renderer/components/philharmonic/lib/hue.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

import { HUE_NAMES, pickHue, hueStyle } from './hue'

describe('pickHue', () => {
  it('returns a stable hue for the same seed', () => {
    expect(pickHue('alice-123')).toBe(pickHue('alice-123'))
  })

  it('covers all 8 hues across many seeds', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) seen.add(pickHue(`seed-${i}`))
    expect(seen.size).toBe(8)
  })

  it('returns a name from HUE_NAMES', () => {
    expect(HUE_NAMES).toContain(pickHue('whatever'))
  })

  it('handles empty and null-ish seeds', () => {
    expect(HUE_NAMES).toContain(pickHue(''))
    expect(HUE_NAMES).toContain(pickHue('null'))
  })
})

describe('hueStyle', () => {
  it('emits the fill + ring CSS variables', () => {
    const style = hueStyle('lilac')
    expect(style.background).toBe('var(--ph-hue-lilac-fill)')
    expect(style.boxShadow).toContain('var(--ph-hue-lilac-ring)')
  })
})
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm test src/renderer/components/philharmonic/lib/hue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `hue.ts`**

`src/renderer/components/philharmonic/lib/hue.ts`:

```ts
import type { CSSProperties } from 'react'

export const HUE_NAMES = [
  'lilac',
  'mint',
  'peach',
  'sky',
  'rose',
  'honey',
  'periwinkle',
  'sage'
] as const

export type HueName = (typeof HUE_NAMES)[number]

function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function pickHue(seed: string | null | undefined): HueName {
  const key = seed && seed.length > 0 ? seed : 'default'
  return HUE_NAMES[hash(key) % HUE_NAMES.length]
}

export function hueStyle(hue: HueName): CSSProperties {
  return {
    background: `var(--ph-hue-${hue}-fill)`,
    boxShadow: `inset 0 0 0 1.5px var(--ph-hue-${hue}-ring)`
  }
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm test src/renderer/components/philharmonic/lib/hue.test.ts`
Expected: PASS (4 + 1 tests).

### Task 2.3: Create motion tokens module

**Files:**

- Create: `src/renderer/components/philharmonic/lib/motion.ts`

- [ ] **Step 1: Write the module**

`src/renderer/components/philharmonic/lib/motion.ts`:

```ts
export const phMotion = {
  fast: '120ms',
  base: '160ms',
  drawer: '220ms',
  spring: 'cubic-bezier(0.22, 1, 0.36, 1)',
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)'
} as const
```

### Task 2.4: Commit the foundation layer

- [ ] **Step 1: Commit**

```bash
git add -A
git commit -m "feat(philharmonic): add --ph-* design tokens, hue helper, motion module

Adds the Philharmonic-scoped token layer (canvas/surface/sunken,
8-hue avatar palette, radius scale, shadow scale) in light + dark,
a stable pickHue() + hueStyle() helper, motion constants, and a
prefers-reduced-motion safety block.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 3 — Layout: floating cards on canvas

### Task 3.1: Update PhilharmonicContainer to use canvas + cards

**Files:**

- Modify: `src/renderer/containers/philharmonic.tsx` (replace the outer grid wrapper)

- [ ] **Step 1: Replace the grid wrapper**

Find the existing return block (it currently does):

```tsx
return (
  <div
    className="grid h-full min-h-0 w-full"
    style={{
      gridTemplateColumns: showMembers ? '260px 1fr 260px' : '260px 1fr'
    }}
  >
    <div className="min-h-0 min-w-0 border-r">…</div>
    <div className="min-h-0 min-w-0 overflow-hidden">{mainContent}</div>
    {showMembers && <div className="min-h-0 min-w-0 border-l">…</div>}
  </div>
)
```

Replace with:

```tsx
const isFullscreen = useIsFullscreen()

return (
  <div
    className="grid h-full w-full bg-[var(--ph-canvas)]"
    style={{
      padding: isFullscreen ? '12px' : '10px',
      gap: '10px',
      gridTemplateColumns: showMembers ? '260px 1fr 260px' : '260px 1fr',
      transition: 'grid-template-columns 180ms cubic-bezier(0.16, 1, 0.3, 1)'
    }}
  >
    <div className="min-h-0 min-w-0 overflow-hidden rounded-[var(--ph-radius-xl)] bg-[var(--ph-surface)] shadow-[var(--ph-shadow-card)]">
      <ConversationList … />
    </div>
    <div className="min-h-0 min-w-0 overflow-hidden rounded-[var(--ph-radius-xl)] bg-[var(--ph-surface)] shadow-[var(--ph-shadow-card)]">
      {mainContent}
    </div>
    {showMembers && (
      <div className="min-h-0 min-w-0 overflow-hidden rounded-[var(--ph-radius-xl)] bg-[var(--ph-surface)] shadow-[var(--ph-shadow-card)] animate-[ph-fade-in_180ms_ease-out]">
        <GroupMembersPanel … />
      </div>
    )}
  </div>
)
```

Import `useIsFullscreen` from `@/hooks/use-is-full-screen` at the top of the file.

- [ ] **Step 2: Add the `ph-fade-in` keyframe to globals.css**

Append to globals.css:

```css
@keyframes ph-fade-in {
  from {
    opacity: 0;
    transform: translateX(8px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
```

- [ ] **Step 3: Remove `bg-sidebar/40 flex h-full flex-col` outer wrapping from conversation-list.tsx and group-members-panel.tsx**

The card's surface now comes from the container. Inside both components, change the root `<div className="bg-sidebar/40 flex h-full flex-col">` to `<div className="flex h-full flex-col">`.

- [ ] **Step 4: Run typecheck + tests + dev smoke**

```bash
pnpm typecheck && pnpm test
pnpm dev   # background, wait 15s, check log, kill
```

### Task 3.2: Commit layout

- [ ] **Step 1: Commit**

```bash
git add -A
git commit -m "feat(philharmonic): float three column cards on warm canvas

Replaces the edge-to-edge bordered grid with rounded surface cards
on a --ph-canvas backdrop. Members column animates in/out with a
180ms width+fade transition.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 4 — Avatar wrapper with hue ring

### Task 4.1: Extend EmployeeAvatar to optionally render a hue ring

**Files:**

- Modify: `src/renderer/components/philharmonic/employees/employee-avatar.tsx`

- [ ] **Step 1: Add `hue` prop with default = derived from seed**

Replace the file body with:

```tsx
import * as collection from '@dicebear/collection'
import { createAvatar } from '@dicebear/core'
import { DEFAULT_AVATAR_STYLE } from '@shared/constants/avatar'
import { useMemo } from 'react'

import { cn } from '@/lib/utils'

import { hueStyle, pickHue, type HueName } from '../lib/hue'

export function EmployeeAvatar({
  seed,
  style,
  size = 36,
  hue,
  ring = true,
  className
}: {
  seed: string | null
  style: string | null
  size?: number
  hue?: HueName
  ring?: boolean
  className?: string
}) {
  const dataUri = useMemo(() => {
    const styleKey = (style ?? DEFAULT_AVATAR_STYLE) as keyof typeof collection
    const factory =
      collection[styleKey] ??
      collection[DEFAULT_AVATAR_STYLE as keyof typeof collection]
    return createAvatar(factory as never, {
      seed: seed ?? 'default'
    }).toDataUri()
  }, [seed, style])

  const resolvedHue = hue ?? pickHue(seed ?? 'default')
  const wrapperStyle = ring ? hueStyle(resolvedHue) : undefined

  return (
    <div
      className={cn('relative inline-flex shrink-0 rounded-full', className)}
      style={{ width: size, height: size, ...wrapperStyle }}
    >
      <img
        src={dataUri}
        width={size}
        height={size}
        className="rounded-full"
        alt="avatar"
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify call sites still compile**

Run: `pnpm typecheck`
Expected: PASS. Existing call sites passing only `seed` / `style` / `size` continue to work.

### Task 4.2: Commit

- [ ] **Step 1: Commit**

```bash
git add -A
git commit -m "feat(philharmonic): wrap EmployeeAvatar in a stable hue ring

Each avatar now sits inside a colored circle whose hue is derived
from the seed via pickHue(). Existing call sites are source-compatible.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 5 — Conversation list redesign

### Task 5.1: Rebuild conversation-list.tsx with the new visual language

**Files:**

- Modify: `src/renderer/components/philharmonic/chat/conversation-list.tsx`

Detailed structure per spec §3:

- Header (52px): title "Groups" + count chip + primary `+` button
- Search: `--ph-canvas` background, focus shifts to `--ph-surface` + 3px primary-soft ring
- Items: 40×40 hue-ringed icon container, 13.5px / 600 title, 10px timestamp, 12px preview; active = `--ph-primary-faint` bg
- Config nav: single-row segmented pill (active expanded, others icon-only)
- Back-to-chat: 36px row, muted label

- [ ] **Step 1: Replace conversation-list.tsx body**

Replace the file's render output following the spec. Key bullets:

- Use `bg-[var(--ph-surface-sunken)]` for search field unfocused state and `focus-within:bg-[var(--ph-surface)]` on focus
- Active item: `bg-[var(--ph-primary-faint)]`
- Hue-derived conversation icon background: derive `pickHue(c.id)` for each row

Skeleton:

```tsx
import { hueStyle, pickHue } from '../lib/hue'
// … existing imports

// inside the rendered list item button:
;<span
  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg"
  style={hueStyle(pickHue(c.id))}
>
  {c.icon ?? '💬'}
</span>
```

For the active row, use `style={{ background: 'var(--ph-primary-faint)' }}` so the var stays themable; for hover, use a Tailwind utility that maps to a canvas-ish hover.

Convert the bottom three-row config nav into a segmented pill:

```tsx
<nav className="shrink-0 border-t border-[var(--ph-border)] p-2">
  <div className="flex gap-1">
    {CONFIG_NAV.map((item) => {
      const Icon = item.icon
      const isActive = activePage === item.page
      return (
        <button
          key={item.page}
          type="button"
          onClick={() => onNavigateConfig(item.page)}
          className={cn(
            'flex h-9 items-center justify-center gap-1.5 rounded-[var(--ph-radius-md)] px-2 text-xs font-medium transition-all',
            isActive
              ? 'flex-1 bg-[var(--ph-primary-soft)] text-[oklch(0.32_0.1_160)]'
              : 'h-9 w-9 text-[var(--ph-text-muted)] hover:bg-[var(--ph-canvas)]'
          )}
          title={item.label}
        >
          <Icon className="h-4 w-4" />
          {isActive && <span className="truncate">{item.label}</span>}
        </button>
      )
    })}
  </div>
</nav>
```

The header `+` button becomes solid primary:

```tsx
<Button
  size="icon-sm"
  onClick={onCreate}
  aria-label="New group"
  className="no-drag h-8 w-8 rounded-[var(--ph-radius-md)] bg-[var(--ph-primary)] text-white hover:opacity-90"
>
  <PlusIcon className="h-4 w-4" />
</Button>
```

Add a count chip next to the (otherwise hidden) "Groups" title:

```tsx
<div className="flex items-center gap-2 text-sm font-semibold">
  Groups
  <span className="rounded-full bg-[var(--ph-canvas)] px-2 py-0.5 text-[10px] font-normal text-[var(--ph-text-muted)]">
    {conversations.length}
  </span>
</div>
```

(Note: the drag area pl-21 trick when not fullscreen is preserved; integrate the title cluster on the right side of the drag region, not in it.)

- [ ] **Step 2: Run typecheck + dev smoke**

```bash
pnpm typecheck
pnpm dev   # background 15s, check, kill
```

### Task 5.2: Commit

- [ ] **Step 1: Commit**

```bash
git add -A
git commit -m "feat(philharmonic): conversation list — primary CTA, hue avatars, segmented config nav

New header with title + count + filled primary +; sunken search
that lights to surface on focus; rows use hue-ringed icon containers
with --ph-primary-faint active state; config nav compresses three
vertical buttons into one horizontal segmented pill that expands
the active item.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 6 — Chat header + bubbles + tool cards

### Task 6.1: Rebuild GroupChat header (stacked avatars + secondary line)

**Files:**

- Modify: `src/renderer/components/philharmonic/chat/group-chat.tsx`

- [ ] **Step 1: Replace the header section**

In the existing header area, render up to 3 member avatars stacked with overlap, plus a `+N` chip if there are more, then title + "{count} members · {team}" secondary line.

```tsx
const visibleMembers = activeMembers.slice(0, 3)
const overflow = Math.max(0, activeMembers.length - 3)
const primaryTeam = visibleMembers[0]?.teamId
  ? teamsById[visibleMembers[0].teamId!]?.name
  : null

<div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--ph-border)] px-4">
  <div className="flex items-center gap-3">
    <div className="flex">
      {visibleMembers.map((m, i) => (
        <EmployeeAvatar
          key={m.id}
          seed={m.avatarSeed}
          style={m.avatarStyle}
          size={30}
          className={cn(i > 0 && '-ml-2 ring-2 ring-[var(--ph-surface)]')}
        />
      ))}
      {overflow > 0 && (
        <span
          className="-ml-2 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[var(--ph-canvas)] text-[10px] font-semibold text-[var(--ph-text-muted)] ring-2 ring-[var(--ph-surface)]"
        >
          +{overflow}
        </span>
      )}
    </div>
    <div className="min-w-0">
      {editingTitle ? (
        <Input
          autoFocus
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === 'Enter' && commitTitle()}
          className="h-7 rounded-[var(--ph-radius-md)] bg-[var(--ph-surface-sunken)] px-2 text-sm font-semibold"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditingTitle(true)}
          className="truncate text-sm font-semibold text-[var(--ph-text)] hover:underline"
        >
          {conversation.title}
        </button>
      )}
      <div className="truncate text-[11px] text-[var(--ph-text-muted)]">
        {activeMembers.length} members{primaryTeam ? ` · ${primaryTeam}` : ''}
      </div>
    </div>
  </div>
</div>
```

(`activeMembers` is the derived array of agent records for this conversation. It's already computed in the surrounding container as `members`; pass it through as a prop or recompute in scope.)

- [ ] **Step 2: Decide active member access**

If `members` isn't already passed to `GroupChat`, add it as a prop: `members: AgentData[]`. Update the call site in `philharmonic.tsx` to pass it.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

### Task 6.2: Rebuild message bubbles

**Files:**

- Modify: `src/renderer/components/philharmonic/chat/group-message-bubble.tsx`

- [ ] **Step 1: Rewrite bubble rendering**

Replace the existing return statements with three styled variants — PM / employee / user — each with an asymmetric border-radius and the spec's avatar styling. Keep the system-message pill as-is.

```tsx
// system pill stays:
if (isSystem) {
  return (
    <div className="flex justify-center py-2">
      <span className="rounded-full bg-[var(--ph-canvas)] px-3 py-0.5 text-xs text-[var(--ph-text-muted)]">
        {bubble.text}
      </span>
    </div>
  )
}

const time = bubble.createdAt ? format(new Date(bubble.createdAt), 'HH:mm') : ''
const headerLine = `${name}${time ? ` · ${time}` : ''}`

return (
  <div className={cn('flex gap-2.5 px-1 py-1.5', isUser && 'flex-row-reverse')}>
    {isPm ? (
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-[var(--ph-surface)]"
        style={{
          background: 'var(--ph-primary)',
          boxShadow: 'inset 0 0 0 1.5px var(--ph-primary-soft)'
        }}
      >
        PM
      </div>
    ) : isUser ? (
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        style={{
          background: 'var(--ph-primary-soft)',
          color: 'oklch(0.32 0.1 160)'
        }}
      >
        You
      </div>
    ) : (
      <EmployeeAvatar
        seed={agent?.avatarSeed ?? null}
        style={agent?.avatarStyle ?? null}
        size={36}
      />
    )}
    <div className="flex max-w-[75%] flex-col">
      <span
        className={cn(
          'mb-1 text-[11px] text-[var(--ph-text-muted)]',
          isUser && 'text-right'
        )}
      >
        {headerLine}
      </span>
      <div
        className={cn(
          'px-3.5 py-2.5 text-sm leading-relaxed',
          isUser ? 'text-white' : 'text-[var(--ph-text)]'
        )}
        style={{
          background: isUser ? 'var(--ph-primary)' : 'var(--ph-canvas)',
          borderRadius: isUser
            ? 'var(--ph-radius-xl) 6px var(--ph-radius-xl) var(--ph-radius-xl)'
            : '6px var(--ph-radius-xl) var(--ph-radius-xl) var(--ph-radius-xl)'
        }}
      >
        <Markdown>{bubble.text}</Markdown>
      </div>
      {/* tool cards continue to render below if present, see task 6.3 */}
    </div>
  </div>
)
```

Note: `bubble.createdAt` may not currently exist on the BubbleModel type — add it as optional `createdAt?: string` if it isn't already there (this is what `group-chat.tsx` calls `BubbleWithDate`). If it's not threaded down today, fall back to omitting the time.

- [ ] **Step 2: Run typecheck + tests**

### Task 6.3: Restyle Tool cards

In the same file, the existing `toolCards` rendering (if it lives there) is restyled per spec §4:

- [ ] **Step 1: Restyle the tool card**

```tsx
{
  bubble.toolCards?.map((tc, i) => (
    <div
      key={i}
      className="mt-2 flex items-center gap-2.5 border border-[var(--ph-border)] bg-[var(--ph-surface)] px-3 py-2"
      style={{
        borderRadius:
          '6px var(--ph-radius-lg) var(--ph-radius-lg) var(--ph-radius-lg)'
      }}
    >
      <div
        className="flex h-6 w-6 items-center justify-center rounded-[var(--ph-radius-sm)]"
        style={{ background: 'var(--ph-primary-soft)' }}
      >
        <WrenchIcon
          className="h-3.5 w-3.5"
          style={{ color: 'oklch(0.32 0.1 160)' }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold">{tc.toolName}</div>
      </div>
      {tc.phase === 'start' ? (
        <Loader2Icon
          className="h-3.5 w-3.5 animate-spin"
          style={{ color: 'var(--ph-primary)' }}
        />
      ) : (
        <CheckIcon
          className="h-3.5 w-3.5"
          style={{ color: 'var(--ph-primary)' }}
        />
      )}
    </div>
  ))
}
```

### Task 6.4: Commit chat redesign

- [ ] **Step 1: Commit**

```bash
git add -A
git commit -m "feat(philharmonic): chat header, bubbles, and tool cards

Adopts stacked-avatar header, asymmetric bubble corners, primary-
filled user bubble, PM dual-ring avatar, and a flat sticker-style
tool card with primary spinner/check.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 7 — Composer

### Task 7.1: Rewrite composer.tsx

**Files:**

- Modify: `src/renderer/components/philharmonic/chat/composer.tsx`

- [ ] **Step 1: Replace the body**

```tsx
import { SendIcon } from 'lucide-react'
import { useState } from 'react'

import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export function Composer({
  onSend,
  disabled
}: {
  onSend: (text: string) => void
  disabled?: boolean
}) {
  const [text, setText] = useState('')
  const submit = () => {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }
  const canSend = !disabled && text.trim().length > 0

  return (
    <div
      className="px-4 pt-3 pb-4"
      style={{
        background: 'var(--ph-surface-sunken)',
        borderTop: '1px solid var(--ph-border)'
      }}
    >
      <div className="flex items-end gap-2 rounded-[var(--ph-radius-xl)] border border-[var(--ph-border)] bg-[var(--ph-surface)] p-2 pl-3.5 transition-shadow focus-within:border-[var(--ph-primary)] focus-within:ring-[3px] focus-within:ring-[var(--ph-primary-soft)]">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Message your team…"
          className="max-h-48 min-h-[36px] resize-none border-0 bg-transparent p-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          aria-label="Send"
          className={cn(
            'flex h-[34px] w-[34px] items-center justify-center rounded-[var(--ph-radius-md)] transition-opacity',
            canSend
              ? 'text-white hover:opacity-90'
              : 'cursor-not-allowed text-[var(--ph-text-muted)]'
          )}
          style={{
            background: canSend ? 'var(--ph-primary)' : 'var(--ph-canvas)'
          }}
        >
          <SendIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[10px] text-[var(--ph-text-muted)]">
        Press{' '}
        <kbd className="rounded bg-[var(--ph-canvas)] px-1 py-px">Enter</kbd> to
        send,{' '}
        <kbd className="ml-1 rounded bg-[var(--ph-canvas)] px-1 py-px">
          Shift + Enter
        </kbd>{' '}
        for a new line.
      </p>
    </div>
  )
}
```

Per spec §14 open question default: **no attachment button is rendered** in this redesign.

- [ ] **Step 2: Run typecheck + dev smoke**

### Task 7.2: Commit

- [ ] **Step 1: Commit**

```bash
git add -A
git commit -m "feat(philharmonic): composer with surface-sunken band and primary send button

Replaces the bordered ghost composer with a sunken band housing a
surface-colored input region that picks up a primary border + soft
ring on focus, and a primary-filled send button.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 8 — Members panel

### Task 8.1: Rebuild GroupMembersPanel per spec §5

**Files:**

- Modify: `src/renderer/components/philharmonic/chat/group-members-panel.tsx`

- [ ] **Step 1: Replace the body**

Partition members by `teamId`, render group label rows, render member rows with embedded status dots.

```tsx
import { UsersIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { AgentData, TeamData } from '@/stores/philharmonic'

import { EmployeeAvatar } from '../employees/employee-avatar'

interface Group {
  key: string
  label: string
  icon: string | null
  members: AgentData[]
  isCoordinators?: boolean
}

function partition(
  members: AgentData[],
  teamsById: Record<string, TeamData>,
  includePm: boolean
): Group[] {
  const byTeam = new Map<string, AgentData[]>()
  const unassigned: AgentData[] = []
  for (const m of members) {
    if (m.teamId && teamsById[m.teamId]) {
      const arr = byTeam.get(m.teamId) ?? []
      arr.push(m)
      byTeam.set(m.teamId, arr)
    } else {
      unassigned.push(m)
    }
  }
  const teamGroups: Group[] = [...byTeam.entries()]
    .sort(([a], [b]) => teamsById[a].name.localeCompare(teamsById[b].name))
    .map(([id, ms]) => ({
      key: id,
      label: teamsById[id].name,
      icon: teamsById[id].icon ?? null,
      members: ms
    }))
  const groups: Group[] = []
  if (includePm)
    groups.push({
      key: '__coord__',
      label: 'Coordinators',
      icon: '🧭',
      members: [],
      isCoordinators: true
    })
  groups.push(...teamGroups)
  if (unassigned.length)
    groups.push({
      key: '__unassigned__',
      label: 'Unassigned',
      icon: '👤',
      members: unassigned
    })
  return groups
}

export function GroupMembersPanel({
  members,
  teamsById,
  busyAgentIds,
  hasPm = true
}: {
  members: AgentData[]
  teamsById: Record<string, TeamData>
  busyAgentIds: Set<string>
  hasPm?: boolean
}) {
  const groups = partition(members, teamsById, hasPm)
  const idleCount = members.filter((m) => !busyAgentIds.has(m.id)).length
  const busyCount = members.length - idleCount

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-13 shrink-0 items-center justify-between border-b border-[var(--ph-border)] px-3.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          Members
          <span className="rounded-full bg-[var(--ph-canvas)] px-2 py-0.5 text-[10px] font-normal text-[var(--ph-text-muted)]">
            {members.length}
          </span>
        </div>
        <div className="flex gap-3 text-[10.5px] text-[var(--ph-text-muted)]">
          <span className="flex items-center gap-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--ph-success)' }}
            />
            {idleCount} idle
          </span>
          <span className="flex items-center gap-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--ph-warning)' }}
            />
            {busyCount} busy
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {members.length === 0 && !hasPm ? (
          // Empty state — handled by shared component in phase 13
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <UsersIcon className="h-8 w-8 opacity-40" />
            <div className="text-xs">
              The PM will recruit teammates as needed.
            </div>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.key} className="pt-3">
              <div className="mb-2 flex items-center gap-1.5 px-1 text-[10.5px] tracking-wider text-[var(--ph-text-muted)] uppercase">
                {g.icon && <span>{g.icon}</span>}
                <span>
                  {g.label} · {g.isCoordinators ? 1 : g.members.length}
                </span>
              </div>
              {g.isCoordinators ? (
                <PmRow busy={busyAgentIds.has('__pm__')} />
              ) : (
                g.members.map((m) => {
                  const team = m.teamId ? teamsById[m.teamId] : undefined
                  const busy = busyAgentIds.has(m.id)
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        'flex items-center gap-2.5 rounded-[var(--ph-radius-md)] px-2 py-2',
                        busy && 'bg-[var(--ph-surface-sunken)]'
                      )}
                    >
                      <div className="relative">
                        <EmployeeAvatar
                          seed={m.avatarSeed}
                          style={m.avatarStyle}
                          size={36}
                        />
                        <span
                          className={cn(
                            'absolute right-0 bottom-0 h-[11px] w-[11px] rounded-full ring-2',
                            busy && 'animate-pulse'
                          )}
                          style={{
                            background: busy
                              ? 'var(--ph-warning)'
                              : 'var(--ph-success)',
                            boxShadow: `0 0 0 2px ${busy ? 'var(--ph-surface-sunken)' : 'var(--ph-surface)'}`
                          }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {m.name}
                        </div>
                        <div
                          className="truncate text-xs"
                          style={{
                            color: busy
                              ? 'var(--ph-warning)'
                              : 'var(--ph-text-muted)'
                          }}
                        >
                          {busy
                            ? 'running…'
                            : `${team?.name ?? 'No team'} · idle`}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function PmRow({ busy }: { busy: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-[var(--ph-radius-md)] px-2 py-2',
        busy && 'bg-[var(--ph-surface-sunken)]'
      )}
    >
      <div className="relative">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-semibold text-white"
          style={{
            background: 'var(--ph-primary)',
            boxShadow: 'inset 0 0 0 1.5px var(--ph-primary-soft)'
          }}
        >
          PM
        </div>
        <span
          className={cn(
            'absolute right-0 bottom-0 h-[11px] w-[11px] rounded-full ring-2',
            busy && 'animate-pulse'
          )}
          style={{
            background: busy ? 'var(--ph-warning)' : 'var(--ph-success)',
            boxShadow: `0 0 0 2px ${busy ? 'var(--ph-surface-sunken)' : 'var(--ph-surface)'}`
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">PM</div>
        <div
          className="truncate text-xs"
          style={{
            color: busy ? 'var(--ph-warning)' : 'var(--ph-text-muted)'
          }}
        >
          {busy ? 'orchestrating…' : 'Strategy · idle'}
        </div>
      </div>
    </div>
  )
}
```

### Task 8.2: Commit

- [ ] **Step 1: Commit**

```bash
git add -A
git commit -m "feat(philharmonic): members panel grouped by team with status summary

Header shows idle/busy dot pills; rows partition into Coordinators
(PM) + each team + Unassigned. Busy rows get a sunken background;
status dots use a ring matching the row background so they look
embedded.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 9 — Workforce page

### Task 9.1: Page header with summary + 2 CTAs

**Files:**

- Modify: `src/renderer/components/philharmonic/workforce/workforce-page.tsx`

- [ ] **Step 1: Add a sticky page header at the top of the WorkforcePage render**

```tsx
<header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-[var(--ph-border)] bg-[var(--ph-surface)] px-5">
  <div>
    <div className="text-sm font-semibold">Workforce</div>
    <div className="text-[11.5px] text-[var(--ph-text-muted)]">
      {employees.length} employees · {teams.length} teams
    </div>
  </div>
  <div className="flex gap-1.5">
    <button
      type="button"
      onClick={openNewTeam}
      className="flex h-8 items-center rounded-[var(--ph-radius-md)] bg-[var(--ph-canvas)] px-3 text-xs font-medium"
    >
      + Team
    </button>
    <button
      type="button"
      onClick={() => openNewEmployee(null)}
      className="flex h-8 items-center rounded-[var(--ph-radius-md)] px-3 text-xs font-medium text-white"
      style={{ background: 'var(--ph-primary)' }}
      disabled={teams.length === 0}
    >
      + Employee
    </button>
  </div>
</header>
```

### Task 9.2: Restyle TeamSection header

- [ ] **Step 1: Replace the chevron+icon+name row**

```tsx
const headerContent = (
  <button
    type="button"
    onClick={onToggle}
    className="flex w-full items-center gap-2 rounded-[var(--ph-radius-md)] px-1 py-1.5 text-left hover:bg-[var(--ph-canvas)]"
  >
    <ChevronRight
      className={cn(
        'h-4 w-4 text-[var(--ph-text-muted)] transition-transform',
        !collapsed && 'rotate-90'
      )}
    />
    <span
      className="flex h-8 w-8 items-center justify-center rounded-[var(--ph-radius-md)] text-base"
      style={hueStyle(pickHue(team?.id ?? '__unassigned__'))}
    >
      {team?.icon ??
        (team ? (
          <Building2Icon className="h-4 w-4 opacity-60" />
        ) : (
          <UsersIcon className="h-4 w-4 opacity-60" />
        ))}
    </span>
    <span className="text-sm font-semibold">{team?.name ?? 'No team'}</span>
    <span className="rounded-full bg-[var(--ph-canvas)] px-2 py-0.5 text-[10px] text-[var(--ph-text-muted)]">
      {members.length}
    </span>
    {team?.description && (
      <span className="ml-2 truncate text-xs text-[var(--ph-text-muted)]">
        {team.description}
      </span>
    )}
  </button>
)
```

Import `hueStyle`, `pickHue` from `../lib/hue`.

### Task 9.3: Restyle EmployeeCard with chips

- [ ] **Step 1: Replace EmployeeCard body**

```tsx
function EmployeeCard({ employee, onEdit, onAskDelete }: EmployeeCardProps) {
  const modelChip = employee.model
  const tools = employee.toolAllowList ?? []
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <button
          onClick={() => onEdit(employee)}
          className="group flex w-full items-start gap-3 rounded-[var(--ph-radius-lg)] px-3.5 py-3 text-left transition-shadow hover:shadow-[var(--ph-shadow-hover)]"
          style={{ background: 'var(--ph-surface-sunken)' }}
        >
          <EmployeeAvatar
            seed={employee.avatarSeed}
            style={employee.avatarStyle}
            size={44}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              {employee.name}
            </div>
            {employee.description && (
              <div className="line-clamp-2 text-[11.5px] text-[var(--ph-text-muted)]">
                {employee.description}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {modelChip && (
                <span
                  className="rounded-[var(--ph-radius-sm)] px-1.5 py-0.5 text-[10px]"
                  style={{
                    background: 'var(--ph-primary-soft)',
                    color: 'oklch(0.32 0.1 160)'
                  }}
                >
                  {modelChip}
                </span>
              )}
              {tools.slice(0, 2).map((t) => (
                <span
                  key={t}
                  className="rounded-[var(--ph-radius-sm)] bg-[var(--ph-canvas)] px-1.5 py-0.5 text-[10px] text-[var(--ph-text-muted)]"
                >
                  {t}
                </span>
              ))}
              {tools.length > 2 && (
                <span className="rounded-[var(--ph-radius-sm)] bg-[var(--ph-canvas)] px-1.5 py-0.5 text-[10px] text-[var(--ph-text-muted)]">
                  +{tools.length - 2}
                </span>
              )}
            </div>
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onEdit(employee)}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Edit
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => onAskDelete(employee)}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
```

### Task 9.4: Add-employee placeholder card and collapse Unassigned by default

- [ ] **Step 1: Replace the placeholder button**

Inside `TeamSection`'s grid (when `members.length === 0` and as a trailing card otherwise), render:

```tsx
<button
  onClick={() => onAddEmployeeToTeam(team?.id ?? null)}
  className="flex min-h-[88px] items-center justify-center gap-2 rounded-[var(--ph-radius-lg)] border border-dashed border-[var(--ph-border)] text-xs text-[var(--ph-text-muted)] transition-colors hover:border-[var(--ph-primary)] hover:text-[var(--ph-primary)]"
>
  <Plus className="h-3.5 w-3.5" />
  Add employee
</button>
```

Make it always render as the last grid cell (so a populated team also gets a trailing placeholder card).

- [ ] **Step 2: Default Unassigned to collapsed**

In the WorkforcePage component, when initializing `collapsed`, set the unassigned key to `true`:

```tsx
const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
  __unassigned__: true
})
```

### Task 9.5: Commit

- [ ] **Step 1: Commit**

```bash
git add -A
git commit -m "feat(philharmonic): workforce page with header CTAs, hue team icons, chip cards

Adds a sticky page header with summary + Team/Employee CTAs. Team
section icons sit in hue containers. Employee cards expose model
+ tool chips and float on --ph-surface-sunken. Each team grid ends
in a dashed add-employee placeholder. Unassigned defaults collapsed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 10 — Knowledge Base page

### Task 10.1: Restyle knowledge-base-page.tsx

**Files:**

- Modify: `src/renderer/components/philharmonic/knowledge/knowledge-base-page.tsx`

- [ ] **Step 1: Add page header**

Wrap the existing content with a sticky header containing summary + `+ Document` button. Compute total tokens via `docs.reduce((sum, d) => sum + d.content.length, 0)` (rough proxy — spec wording is "tokens" but we don't have a tokenizer; render as `{count} characters` if more honest, or omit the secondary stat).

- [ ] **Step 2: Restyle doc rows**

```tsx
{
  docs.map((d) => (
    <div
      key={d.id}
      className="flex items-start gap-3 rounded-[var(--ph-radius-lg)] px-3.5 py-3 transition-shadow hover:shadow-[var(--ph-shadow-hover)]"
      style={{ background: 'var(--ph-surface-sunken)' }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--ph-radius-md)] text-base"
        style={hueStyle(pickHue(d.id))}
      >
        📄
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate text-sm font-semibold">{d.title}</h3>
          {/* time stamp here if available */}
        </div>
        <p className="line-clamp-2 text-xs text-[var(--ph-text-muted)]">
          {d.content}
        </p>
      </div>
      <button
        onClick={async () => {
          await deleteKnowledgeDoc(d.id)
          setDocs((p) => p.filter((x) => x.id !== d.id))
        }}
        aria-label="Delete"
        className="rounded-[var(--ph-radius-sm)] p-1 text-[var(--ph-text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  ))
}
```

- [ ] **Step 3: Restyle the editor card**

```tsx
<div
  className="space-y-2 rounded-[var(--ph-radius-lg)] p-3.5"
  style={{ background: 'var(--ph-surface-sunken)' }}
>
  <div className="text-[11px] tracking-wider text-[var(--ph-text-muted)] uppercase">
    New document
  </div>
  <Input
    value={title}
    onChange={(e) => setTitle(e.target.value)}
    placeholder="Title"
    className="rounded-[var(--ph-radius-md)] border-[var(--ph-border)] bg-[var(--ph-surface)]"
  />
  <Textarea
    value={content}
    onChange={(e) => setContent(e.target.value)}
    placeholder="Body"
    className="min-h-40 rounded-[var(--ph-radius-md)] border-[var(--ph-border)] bg-[var(--ph-surface)]"
  />
  <button
    onClick={add}
    disabled={!title.trim() || !content.trim()}
    className="flex w-full items-center justify-center rounded-[var(--ph-radius-md)] py-2 text-xs font-medium text-white disabled:opacity-50"
    style={{ background: 'var(--ph-primary)' }}
  >
    <Plus className="mr-1 h-4 w-4" />
    Add document
  </button>
</div>
```

### Task 10.2: Commit

- [ ] **Step 1: Commit**

```bash
git add -A
git commit -m "feat(philharmonic): knowledge base page redesign

Adds sticky header with primary CTA, doc rows on sunken surface
with hue icon containers and hover trash, and a labeled inline
editor card.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 11 — Cost analysis (Dashboard)

### Task 11.1: Restyle the dashboard

**Files:**

- Modify: `src/renderer/components/philharmonic/cost-analysis.tsx`

Per spec §8:

- [ ] **Step 1: Add a sticky header with title + segmented period control**

Initial period default `'30d'`. Period state is local; data fetch is pre-existing (no API change required for this redesign — period filtering is decorative if not wired).

```tsx
const [period, setPeriod] = useState<'7d' | '30d' | 'all'>('30d')
const periodLabel = period === '7d' ? 'Last 7 days' : period === '30d' ? 'Last 30 days' : 'All time'

<header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-[var(--ph-border)] bg-[var(--ph-surface)] px-5">
  <div>
    <div className="text-sm font-semibold">Dashboard</div>
    <div className="text-[11.5px] text-[var(--ph-text-muted)]">{periodLabel}</div>
  </div>
  <div
    className="flex rounded-[var(--ph-radius-md)] p-0.5"
    style={{ background: 'var(--ph-canvas)' }}
  >
    {(['7d', '30d', 'all'] as const).map((p) => (
      <button
        key={p}
        type="button"
        onClick={() => setPeriod(p)}
        className={cn(
          'rounded-[var(--ph-radius-sm)] px-3 py-1 text-xs font-medium transition-all',
          period === p
            ? 'bg-[var(--ph-surface)] shadow-[0_1px_2px_rgba(0,0,0,.04)]'
            : 'text-[var(--ph-text-muted)]'
        )}
      >
        {p === 'all' ? 'All' : p}
      </button>
    ))}
  </div>
</header>
```

- [ ] **Step 2: Wrap the KPI grid in 4-column layout with hue icon containers**

Replace each Card with a sunken div. Assign one of `Primary / Lilac / Sky / Peach` per KPI in a fixed order.

```tsx
<div className="grid grid-cols-4 gap-2.5 p-4">
  <KpiCard
    label="Total cost"
    value={formatCost(data.totalCost)}
    icon="$"
    hueClass="ph-kpi-primary"
  />
  <KpiCard
    label="Tokens"
    value={formatTokens(data.totalTokens)}
    icon="⚡"
    hueClass="ph-kpi-lilac"
  />
  <KpiCard
    label="Employees"
    value={String(data.employeeCount)}
    icon="👥"
    hueClass="ph-kpi-sky"
  />
  <KpiCard
    label="Avg / msg"
    value={formatCost(data.avgPerMsg)}
    icon="📈"
    hueClass="ph-kpi-peach"
  />
</div>
```

`KpiCard` is an inline helper:

```tsx
function KpiCard({
  label,
  value,
  icon,
  iconBg,
  iconColor
}: {
  label: string
  value: string
  icon: string
  iconBg: string
  iconColor: string
}) {
  return (
    <div
      className="rounded-[var(--ph-radius-lg)] p-3.5"
      style={{ background: 'var(--ph-surface-sunken)' }}
    >
      <div className="mb-2 flex items-start justify-between">
        <span className="text-[11.5px] text-[var(--ph-text-muted)]">
          {label}
        </span>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-[var(--ph-radius-md)] text-sm"
          style={{ background: iconBg, color: iconColor }}
        >
          {icon}
        </span>
      </div>
      <div className="text-[22px] font-bold tabular-nums">{value}</div>
    </div>
  )
}
```

Replace the four hue/color pairs inline at the call sites; KPIs use:

- Primary: `iconBg=var(--ph-primary-soft)`, `iconColor=oklch(0.32 0.1 160)`
- Lilac: `iconBg=var(--ph-hue-lilac-fill)`, `iconColor=var(--ph-hue-lilac-ring)`
- Sky: `iconBg=var(--ph-hue-sky-fill)`, `iconColor=var(--ph-hue-sky-ring)`
- Peach: `iconBg=var(--ph-hue-peach-fill)`, `iconColor=var(--ph-hue-peach-ring)`

- [ ] **Step 3: Update Recharts palette**

```tsx
const chartConfig = {
  cost: {
    label: 'Cost',
    color: 'var(--ph-primary)'
  }
} satisfies ChartConfig
```

For the AreaChart, set `stroke="var(--ph-primary)"` and use a linear gradient defined in the SVG for the fill (from primary at 0.4 → 0).

For multi-series (per agent) charts: cycle a constant array of hue ring colors:

```tsx
const CHART_HUE_ORDER = [
  'var(--ph-primary)',
  'var(--ph-hue-lilac-ring)',
  'var(--ph-hue-mint-ring)',
  'var(--ph-hue-peach-ring)',
  'var(--ph-hue-sky-ring)',
  'var(--ph-hue-rose-ring)',
  'var(--ph-hue-honey-ring)',
  'var(--ph-hue-periwinkle-ring)',
  'var(--ph-hue-sage-ring)'
] as const
```

- [ ] **Step 4: Restyle "Cost by Employee" rows**

Currently a Card wrapping table-like content. Change rows to sunken-surface cards with avatars + tabular numbers.

### Task 11.2: Commit

- [ ] **Step 1: Commit**

```bash
git add -A
git commit -m "feat(philharmonic): dashboard with segmented period, hue KPIs, and charted hue palette

Adds segmented 7d/30d/All control, KPI cards on sunken surface with
hue icon containers, primary-tinted area chart, and a hue cycle for
multi-series visuals. Cost-by-employee becomes a row of soft cards
with tabular numbers.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 12 — Editor drawers

### Task 12.1: Restyle EmployeeEditor + TeamEditor

**Files:**

- Modify: `src/renderer/components/philharmonic/employees/employee-editor.tsx`
- Modify: `src/renderer/components/philharmonic/teams/team-editor.tsx`

- [ ] **Step 1: Identify the Sheet container in WorkforcePage**

In `workforce-page.tsx`, the `<Sheet>` wraps the editors. Add a class on the SheetContent to use a wider, more rounded panel:

```tsx
<SheetContent
  side="right"
  className="w-[520px] rounded-l-[var(--ph-radius-2xl)] border-l-0 bg-[var(--ph-surface)] p-0 shadow-[var(--ph-shadow-drawer)] sm:max-w-none"
>
  {employeeEditor && (
    <EmployeeEditor
      employee={employeeEditor.draft}
      isNew={employeeEditor.isNew}
      onSave={handleSaveEmployee}
      onClose={() => setEmployeeEditor(null)}
    />
  )}
</SheetContent>
```

(Same treatment for TeamEditor's SheetContent.)

- [ ] **Step 2: Sticky header with Cancel/Save**

Inside `EmployeeEditor`, wrap its content with:

```tsx
<div className="flex h-full flex-col">
  <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--ph-border)] px-5">
    <div>
      <div className="text-[11px] tracking-wider text-[var(--ph-text-muted)] uppercase">
        Employee
      </div>
      <div className="text-sm font-semibold">
        {draft.name || 'New employee'}
      </div>
    </div>
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={onClose}
        className="h-8 rounded-[var(--ph-radius-md)] bg-[var(--ph-canvas)] px-3.5 text-xs font-medium"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={() => canSave && onSave(draft)}
        disabled={!canSave}
        className="h-8 rounded-[var(--ph-radius-md)] px-3.5 text-xs font-medium text-white disabled:opacity-50"
        style={{ background: 'var(--ph-primary)' }}
      >
        Save
      </button>
    </div>
  </header>
  <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
    {/* form fields */}
  </div>
</div>
```

- [ ] **Step 3: Restyle form fields with uppercase labels**

Replace each `<Label>` + `<Input>` cluster with:

```tsx
<div>
  <div className="mb-1 text-[11px] tracking-wider text-[var(--ph-text-muted)] uppercase">
    Name
  </div>
  <Input
    value={draft.name}
    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
    className="rounded-[var(--ph-radius-md)] border-[var(--ph-border)] bg-[var(--ph-surface-sunken)]"
  />
</div>
```

Repeat the same pattern for all fields. Keep validation + persistence behavior unchanged.

- [ ] **Step 4: Add 64×64 avatar + pencil**

At the top of the form body, render:

```tsx
<div className="flex items-center gap-4">
  <div className="relative">
    <EmployeeAvatar
      seed={draft.avatarSeed}
      style={draft.avatarStyle}
      size={64}
    />
    <button
      type="button"
      onClick={() => setAvatarPickerOpen(true)}
      className="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--ph-surface)] shadow-[0_1px_4px_rgba(0,0,0,.12)]"
      aria-label="Edit avatar"
    >
      <Pencil className="h-3 w-3" />
    </button>
  </div>
  {/* name field on the right, etc */}
</div>
```

(`Pencil` from `lucide-react`; `setAvatarPickerOpen` is local state.)

### Task 12.2: Restyle AvatarPicker (popover)

**Files:**

- Modify: `src/renderer/components/philharmonic/employees/avatar-picker.tsx`

Read the file first; add an 8-hue row and a style grid per spec §9.

Implementation hint: hue selection should write `draft.avatarHue` IF the schema supports it; otherwise we derive at display time via `pickHue(draft.avatarSeed)`. Since the schema doesn't currently have an explicit hue column, **do not add a column** — derive from seed at display time and provide a "Randomize" button that calls `randomAvatarSeed()` for both hue change and shape change.

### Task 12.3: Commit

- [ ] **Step 1: Commit**

```bash
git add -A
git commit -m "feat(philharmonic): editor drawer with sticky header CTAs and labeled fields

Drawer rounded left edge, soft canvas backdrop. Cancel/Save move to
the header so long forms (system prompt, MCP servers) keep them
reachable. Form fields adopt uppercase label + sunken input rhythm.
64px avatar with pencil-trigger AvatarPicker.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 13 — Empty state component + AlertDialog

### Task 13.1: Create shared PhilharmonicEmptyState

**Files:**

- Create: `src/renderer/components/philharmonic/empty-state.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { type ReactNode } from 'react'

import type { HueName } from './lib/hue'

interface AvatarSpec {
  hue: HueName
  content?: ReactNode
}

interface Props {
  avatars: AvatarSpec[]
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

export function PhilharmonicEmptyState({
  avatars,
  title,
  description,
  action
}: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex">
        {avatars.map((a, i) => (
          <div
            key={i}
            className={i === 0 ? '' : '-ml-2'}
            style={{
              width: i === 1 ? 56 : 48,
              height: i === 1 ? 56 : 48,
              borderRadius: '50%',
              background: `var(--ph-hue-${a.hue}-fill)`,
              boxShadow: `inset 0 0 0 1.5px var(--ph-hue-${a.hue}-ring), 0 0 0 3px var(--ph-surface)`,
              transform:
                i === 0 ? 'rotate(-8deg)' : i === 2 ? 'rotate(8deg)' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              zIndex: i === 1 ? 1 : 0
            }}
          >
            {a.content}
          </div>
        ))}
      </div>
      <div className="text-sm font-semibold">{title}</div>
      {description && (
        <div className="mt-1 max-w-[280px] text-[12.5px] text-[var(--ph-text-muted)]">
          {description}
        </div>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 h-9 rounded-[var(--ph-radius-md)] px-3.5 text-xs font-medium text-white"
          style={{ background: 'var(--ph-primary)' }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire empty-state into the four locations**

Replace the empty-state JSX in:

- `philharmonic.tsx` (no-conversation case in the middle column)
- `conversation-list.tsx` (no groups yet)
- `knowledge-base-page.tsx` (no documents yet)
- `group-members-panel.tsx` (already handled, but switch to the shared component)

Each with `<PhilharmonicEmptyState>` filling in the right hues/title/description/action.

### Task 13.2: Restyle AlertDialog usage

The AlertDialog primitive is shadcn-based. We don't change the primitive — instead, override its container styling at call sites (the two confirmation dialogs in `workforce-page.tsx` and `conversation-list.tsx`):

- [ ] **Step 1: Apply new classes to the AlertDialogContent in each call site**

```tsx
<AlertDialogContent className="rounded-[var(--ph-radius-2xl)] border-[var(--ph-border)] bg-[var(--ph-surface)] shadow-[var(--ph-shadow-card)]">
```

- [ ] **Step 2: Render the deleted object's name as a monospace chip in the description**

In `AlertDialogDescription` body:

```tsx
"
<span className="rounded-[var(--ph-radius-sm)] bg-[var(--ph-canvas)] px-1 py-0.5 font-mono text-xs">
  {confirming.title}
</span>
" and all its messages, tasks, and executions will be permanently removed.
```

- [ ] **Step 3: Make the destructive AlertDialogAction primary-filled red**

```tsx
<AlertDialogAction
  onClick={…}
  className="bg-[var(--ph-danger)] text-white hover:opacity-90"
>
  Delete
</AlertDialogAction>
```

### Task 13.3: Commit

- [ ] **Step 1: Commit**

```bash
git add -A
git commit -m "feat(philharmonic): shared empty-state component and red destructive dialogs

Single PhilharmonicEmptyState with stacked hue avatars; used in
chat, conversations, knowledge base, and members panel. AlertDialog
adopts the new radius/shadow language and a filled red destructive
action.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 14 — Final verification + CLAUDE.md update

### Task 14.1: Run full verification

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 3: Tests**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 4: Format**

Run: `pnpm format`

- [ ] **Step 5: Dev boot smoke**

Run in background: `pnpm dev`
Wait 20 seconds, then check the dev log for compile errors.
Kill the process. Expected: no errors.

### Task 14.2: Update CLAUDE.md to mention the rename

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace AgentX mentions with Philharmonic**

Find any references to "AgentX" or `agent-x` in `CLAUDE.md` and update them to "Philharmonic" / `philharmonic`. Add a one-line note near the architecture section explaining the rename happened on 2026-06-02.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md to reflect AgentX → Philharmonic rename

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Plan Self-Review

**Spec coverage:**

- §0 Rename → Phase 1 ✓
- §1 Design tokens → Phase 2 ✓
- §2 Layout → Phase 3 ✓
- §3 Conversation list → Phase 5 ✓
- §4 Chat → Phase 6 + 7 (composer) ✓
- §5 Members → Phase 8 ✓
- §6 Workforce → Phase 9 ✓
- §7 Knowledge Base → Phase 10 ✓
- §8 Dashboard → Phase 11 ✓
- §9 Editor drawers → Phase 12 ✓
- §10 Empty state + AlertDialog → Phase 13 ✓
- §11 Motion → folded into Phase 2 (tokens + reduced-motion gate) and applied inline in each phase via CSS transitions ✓
- §12 Dark mode → folded into Phase 2 tokens ✓
- §13 File touchpoints → covered across phases ✓
- §14 Attachment open question → resolved as "no attachment button" in Phase 7 ✓
- §15 Out of scope → respected

**Placeholder scan:**

- No "TBD" / "TODO" / "fill in later" in any step.
- Every code-modifying step includes the code.

**Type consistency:**

- `PhilharmonicContainer`, `PhilharmonicLayout`, `PhilharmonicPage`, `philharmonicRouter`, `pickHue`, `hueStyle`, `HueName`, `HUE_NAMES`, `phMotion`, `PhilharmonicEmptyState` are used consistently across tasks.

**Open execution notes:**

- Some heavy AI logic files in `src/main/lib/ai/philharmonic/` are renamed but their internal contents (system prompts mentioning "AgentX" etc.) may also need string substitutions — Phase 1 Step 3 covers user-facing strings, but Phase 1 should also grep the prompt-template files for "AgentX" mentions inside backticks and update them.
- The brainstorm Visual Companion server is still running. Leave it alone — it'll auto-stop after 30 min of inactivity.
- Push a "waiting" screen to the browser when each phase commits, so if the user wakes up mid-flight they see a status.
