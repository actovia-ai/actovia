# i18n Phase 2 — `chat` namespace (tool-cards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract every hardcoded English string under
`src/renderer/components/calling-tools/` (except `image-generation/`,
already done) into the `chat` i18n namespace — the second and final half
of the `chat` namespace, completing it. `chat-core` (composer, message
list, TOC, message actions, thinking timeline, LCM status card) is already
done and pushed (`d8ccb255`).

**Architecture:** Same conventions `chat-core` established: components/hooks
call `useTranslation('chat')`; plain non-component/non-hook helper
functions (`prepareMarkdownForPdf`, `formatTabLabel`) import the shared
renderer `i18n` singleton (`@/lib/i18n`) and call `i18n.t('chat:key', …)`.
One new top-level `chat.json` group per card component, matching the
existing flat, feature-grouped style (`toolPreview.*`,
`messageAction.*`, etc.).

**Tech Stack:** React 19, react-i18next v17, i18next v26.

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md` (`chat`
namespace scope includes "tool-call cards").

## Global Constraints

- English only. Do not touch any locale other than `en`.
- i18next separators never overridden: `nsSeparator: ':'`,
  `keySeparator: '.'`. A raw `i18n.t(...)` call always uses the explicit
  `chat:key` form; a bare `t('key')` inside a component's own
  `useTranslation('chat')` omits the prefix.
- CLDR plurals: suffix `_one`/`_other` on the JSON key's last dot-segment,
  call `t('key', { count })`.
- Renderer, inside a component: `const { t } = useTranslation('chat')`,
  called once at the top of each function component that owns literals —
  a file with multiple components (e.g. `artifact-card.tsx`'s `UrlPill` +
  `FullscreenButton`) needs one call per component, not one shared call.
- Renderer, a plain non-component/non-hook function: `import { i18n } from
  '@/lib/i18n'` → `i18n.t('chat:key', …)`. Never thread `t` through as a
  parameter — this project's established, uniform rule is singleton for
  plain functions, hook for components, no third pattern.
- Every key referenced must exist in `src/shared/i18n/locales/en/chat.json`
  (populated by Task 1) — cross-check spelling exactly before using it in
  a later task.
- Dynamic/technical values are NEVER extracted: raw tool/MCP names run
  through `capitalCase()`, caught-exception messages (`e.message`),
  process output (`stdout`/`stderr`/`cwd`/shell commands), file paths,
  Places-API/LLM-provided content (place names, addresses, reviews, day
  labels/summaries), weather-API fields (condition text, wind direction,
  raw numeric readings), unit symbols (`%`, `km/h`, `mm`, `km`, `hPa`).
  These stay exactly as they are in the current code — do not wrap them in
  `t()`, and do not invent a key for them.
- Two things are explicitly OUT OF SCOPE for this plan, deferred as
  separate, differently-shaped follow-ups (do not attempt either):
  - `weather-forecast.tsx`'s `formatTime()` hardcodes 12-hour AM/PM
    notation regardless of locale, and `weather-card.tsx`'s
    `formatTabLabel()` hardcodes `d.toLocaleDateString('en', {...})`
    regardless of the app's resolved locale. Both are locale-aware
    date/time **formatting** bugs (`useFormat()`/`Intl.DateTimeFormat`
    territory per CLAUDE.md's "Adding a User-Facing String" step 4), not
    string-extraction sites — leave every line of both functions
    untouched except where a task below explicitly says otherwise.
  - `symbol-overview-chart.tsx` embeds `"locale": "en"` inside the
    TradingView widget's own JSON config, controlling that third-party
    iframe's internal UI language. TradingView's locale codes don't map
    1:1 to this app's 11 locale IDs — needs its own translation table,
    not a simple `t()` call. Leave this file completely untouched.
- Pre-commit gate: `pnpm format` → `pnpm lint` → `pnpm typecheck` →
  `pnpm i18n:check` → `pnpm test`. The only two standing, pre-verified
  `--no-verify` exceptions (documented in CLAUDE.md's "Pre-commit gate"
  bullet) are (a) the PGlite WASM teardown flake in
  `context-management/index.test.ts`, and (b) the standing,
  already-committed orphan `TEST_IDS.providerModels.modelSelect` id.
  Re-verify the exact cause yourself before invoking either — it is not a
  blanket license to bypass any other failure.
- Before writing any file below, re-run `git status --porcelain -- src/renderer/components/calling-tools/` and `git status --porcelain -- src/renderer/components/messages-calling-tools.tsx` — every file this plan targets was confirmed clean (no concurrent edits) at survey time, but this working tree has repeatedly had other agents/sessions editing files concurrently throughout this whole project. If a target file shows as modified/untracked when a task actually runs, STOP and report NEEDS_CONTEXT rather than blindly overwriting — do not assume the full-file-rewrite steps below are still safe once that happens.

---

### Task 1: `chat.json` catalog additions + test extension

**Files:**

- Modify: `src/shared/i18n/locales/en/chat.json`
- Modify: `tests/unit/i18n/chat-namespace.test.ts`

**Interfaces:**

- Produces: every JSON key path used by Tasks 2-8 (listed in full below).
  No later task may invent a key not listed here.

- [ ] **Step 1: Add these top-level groups to `chat.json`**

The file currently ends with the `"upload"` group (see it for exact
current content — do not touch it or anything above it). Add these 10 new
top-level groups, inserted after `"upload"` (i.e. add a comma after
`"upload"`'s closing `}` and insert the new groups before the file's final
closing `}`):

```json
  "artifactCard": {
    "cannotOpenTitle": "Cannot open artifact file",
    "missingFileDescription": "The saved .tsx file is missing — it may have been moved or deleted.",
    "resolveFailedDescription": "Could not resolve the artifact path.",
    "revealAriaLabel": "Reveal {{title}} in file manager",
    "revealTitle": "Reveal in file manager",
    "exitFullscreen": "Exit fullscreen",
    "enterFullscreen": "Enter fullscreen",
    "exitFullscreenEsc": "Exit fullscreen (Esc)",
    "fullscreen": "Fullscreen"
  },
  "computerUseCard": {
    "title": "Computer Use",
    "stopFailedTitle": "Could not stop the session",
    "stopFailedDescription": "The stop request failed — try again.",
    "answerFailedTitle": "Could not send your answer",
    "answerFailedDescription": "The request failed — try again.",
    "error": "error",
    "running": "running…",
    "outcome": {
      "success": "success",
      "failed": "failed",
      "aborted": "aborted",
      "abandoned": "abandoned",
      "stuck": "stuck"
    },
    "stepBadge": "step {{step}}",
    "stepWithAction": "Step {{step}}: {{action}}",
    "stepNoAction": "Step {{step}}: …",
    "targetWindowAlt": "Target window at step {{step}}",
    "replyPlaceholder": "Type a reply, or leave blank when done",
    "doneContinue": "Done — continue",
    "waitingForReply": "Waiting for the session to accept a reply…",
    "stop": "Stop",
    "session": "session: {{sessionId}}"
  },
  "deepResearchCard": {
    "researching": "Deep Researching...",
    "completedSummary_one": "Research completed in {{minutes}}m · {{count}} source",
    "completedSummary_other": "Research completed in {{minutes}}m · {{count}} sources",
    "exportAriaLabel": "Export as PDF",
    "downloadPdfTooltip": "Download PDF",
    "exportFailedTitle": "Export failed",
    "exportFailedDescription": "Failed to generate PDF report.",
    "unknownSource": "[{{rank}}] Unknown source"
  },
  "drawioCard": {
    "noSource": "Draw.io tool returned no diagram source.",
    "iframeTitle": "draw.io diagram",
    "openInDrawio": "Open in draw.io",
    "loadFailed": "Failed to load draw.io editor"
  },
  "genericToolCard": {
    "fallbackLabel": "Tool",
    "badge": "tool"
  },
  "mapItineraryCard": {
    "missingApiKey": "Add a Google API Key in Settings → Google Cloud to render the trip map.",
    "tabsAriaLabel": "Itinerary days",
    "openRouteTitle": "Open route in Google Maps",
    "copyMarkdownTitle": "Copy day as markdown"
  },
  "placeDetail": {
    "goToPhotoAriaLabel": "Go to photo {{index}}",
    "closeAriaLabel": "Close detail panel",
    "open": "Open",
    "closed": "Closed",
    "tabsAriaLabel": "Place sections",
    "tabOverview": "Overview",
    "tabReviews": "Reviews",
    "tabHours": "Hours",
    "notes": "Notes",
    "anonymousReviewer": "Anonymous",
    "previousAriaLabel": "Previous place",
    "nextAriaLabel": "Next place",
    "pagination": "{{index}} of {{total}}"
  },
  "terminalCard": {
    "exitCode": "exit {{code}}",
    "noOutput": "No output"
  },
  "weatherCard": {
    "today": "Today",
    "tomorrow": "Tmr",
    "feels": "Feels {{temp}}° · {{observedAt}}",
    "humidity": "Humidity",
    "precip": "Precip",
    "visibility": "Visibility",
    "uvIndex": "UV Index"
  },
  "weatherForecast": {
    "temperatureRange": "🌡️ Temperature range",
    "cold": "❄️ Cold",
    "hot": "🔥 Hot",
    "sunrise": "Sunrise",
    "sunset": "Sunset"
  }
```

`"tomorrow": "Tmr"` is intentionally kept as the exact current abbreviated
English text — this pass extracts copy as-is verbatim; it does not
redesign it (machine translation and any copy polish happen in later
phases, not here).

- [ ] **Step 2: Run `pnpm i18n:check` to confirm catalog parity**

Run: `pnpm i18n:check`
Expected: PASS.

- [ ] **Step 3: Extend `tests/unit/i18n/chat-namespace.test.ts`**

The file currently ends with a `describe('chat namespace
composerTools.mcpDialog.description renders correctly via Trans', ...)`
block (read the file to confirm this is still its exact tail). Append this
new `describe` block after it, at the end of the file:

```typescript
describe('chat namespace (en) — tool-card additions', () => {
  it('has the artifactCard keys', () => {
    expect(chat.artifactCard.cannotOpenTitle).toBe('Cannot open artifact file')
    expect(chat.artifactCard.missingFileDescription).toBe(
      'The saved .tsx file is missing — it may have been moved or deleted.'
    )
    expect(chat.artifactCard.resolveFailedDescription).toBe(
      'Could not resolve the artifact path.'
    )
    expect(chat.artifactCard.revealAriaLabel).toBe(
      'Reveal {{title}} in file manager'
    )
    expect(chat.artifactCard.revealTitle).toBe('Reveal in file manager')
    expect(chat.artifactCard.exitFullscreen).toBe('Exit fullscreen')
    expect(chat.artifactCard.enterFullscreen).toBe('Enter fullscreen')
    expect(chat.artifactCard.exitFullscreenEsc).toBe('Exit fullscreen (Esc)')
    expect(chat.artifactCard.fullscreen).toBe('Fullscreen')
  })

  it('has the computerUseCard keys, including the outcome enum', () => {
    expect(chat.computerUseCard.title).toBe('Computer Use')
    expect(chat.computerUseCard.stopFailedTitle).toBe(
      'Could not stop the session'
    )
    expect(chat.computerUseCard.stopFailedDescription).toBe(
      'The stop request failed — try again.'
    )
    expect(chat.computerUseCard.answerFailedTitle).toBe(
      'Could not send your answer'
    )
    expect(chat.computerUseCard.answerFailedDescription).toBe(
      'The request failed — try again.'
    )
    expect(chat.computerUseCard.error).toBe('error')
    expect(chat.computerUseCard.running).toBe('running…')
    expect(chat.computerUseCard.outcome.success).toBe('success')
    expect(chat.computerUseCard.outcome.failed).toBe('failed')
    expect(chat.computerUseCard.outcome.aborted).toBe('aborted')
    expect(chat.computerUseCard.outcome.abandoned).toBe('abandoned')
    expect(chat.computerUseCard.outcome.stuck).toBe('stuck')
    expect(chat.computerUseCard.stepBadge).toBe('step {{step}}')
    expect(chat.computerUseCard.stepWithAction).toBe(
      'Step {{step}}: {{action}}'
    )
    expect(chat.computerUseCard.stepNoAction).toBe('Step {{step}}: …')
    expect(chat.computerUseCard.targetWindowAlt).toBe(
      'Target window at step {{step}}'
    )
    expect(chat.computerUseCard.replyPlaceholder).toBe(
      'Type a reply, or leave blank when done'
    )
    expect(chat.computerUseCard.doneContinue).toBe('Done — continue')
    expect(chat.computerUseCard.waitingForReply).toBe(
      'Waiting for the session to accept a reply…'
    )
    expect(chat.computerUseCard.stop).toBe('Stop')
    expect(chat.computerUseCard.session).toBe('session: {{sessionId}}')
  })

  it('has the deepResearchCard keys, including a CLDR plural pair', () => {
    expect(chat.deepResearchCard.researching).toBe('Deep Researching...')
    expect(chat.deepResearchCard.completedSummary_one).toBe(
      'Research completed in {{minutes}}m · {{count}} source'
    )
    expect(chat.deepResearchCard.completedSummary_other).toBe(
      'Research completed in {{minutes}}m · {{count}} sources'
    )
    expect(chat.deepResearchCard.exportAriaLabel).toBe('Export as PDF')
    expect(chat.deepResearchCard.downloadPdfTooltip).toBe('Download PDF')
    expect(chat.deepResearchCard.exportFailedTitle).toBe('Export failed')
    expect(chat.deepResearchCard.exportFailedDescription).toBe(
      'Failed to generate PDF report.'
    )
    expect(chat.deepResearchCard.unknownSource).toBe(
      '[{{rank}}] Unknown source'
    )
  })

  it('has the drawioCard keys', () => {
    expect(chat.drawioCard.noSource).toBe(
      'Draw.io tool returned no diagram source.'
    )
    expect(chat.drawioCard.iframeTitle).toBe('draw.io diagram')
    expect(chat.drawioCard.openInDrawio).toBe('Open in draw.io')
    expect(chat.drawioCard.loadFailed).toBe('Failed to load draw.io editor')
  })

  it('has the genericToolCard keys', () => {
    expect(chat.genericToolCard.fallbackLabel).toBe('Tool')
    expect(chat.genericToolCard.badge).toBe('tool')
  })

  it('has the mapItineraryCard keys', () => {
    expect(chat.mapItineraryCard.missingApiKey).toBe(
      'Add a Google API Key in Settings → Google Cloud to render the trip map.'
    )
    expect(chat.mapItineraryCard.tabsAriaLabel).toBe('Itinerary days')
    expect(chat.mapItineraryCard.openRouteTitle).toBe(
      'Open route in Google Maps'
    )
    expect(chat.mapItineraryCard.copyMarkdownTitle).toBe('Copy day as markdown')
  })

  it('has the placeDetail keys', () => {
    expect(chat.placeDetail.goToPhotoAriaLabel).toBe('Go to photo {{index}}')
    expect(chat.placeDetail.closeAriaLabel).toBe('Close detail panel')
    expect(chat.placeDetail.open).toBe('Open')
    expect(chat.placeDetail.closed).toBe('Closed')
    expect(chat.placeDetail.tabsAriaLabel).toBe('Place sections')
    expect(chat.placeDetail.tabOverview).toBe('Overview')
    expect(chat.placeDetail.tabReviews).toBe('Reviews')
    expect(chat.placeDetail.tabHours).toBe('Hours')
    expect(chat.placeDetail.notes).toBe('Notes')
    expect(chat.placeDetail.anonymousReviewer).toBe('Anonymous')
    expect(chat.placeDetail.previousAriaLabel).toBe('Previous place')
    expect(chat.placeDetail.nextAriaLabel).toBe('Next place')
    expect(chat.placeDetail.pagination).toBe('{{index}} of {{total}}')
  })

  it('has the terminalCard keys', () => {
    expect(chat.terminalCard.exitCode).toBe('exit {{code}}')
    expect(chat.terminalCard.noOutput).toBe('No output')
  })

  it('has the weatherCard keys', () => {
    expect(chat.weatherCard.today).toBe('Today')
    expect(chat.weatherCard.tomorrow).toBe('Tmr')
    expect(chat.weatherCard.feels).toBe('Feels {{temp}}° · {{observedAt}}')
    expect(chat.weatherCard.humidity).toBe('Humidity')
    expect(chat.weatherCard.precip).toBe('Precip')
    expect(chat.weatherCard.visibility).toBe('Visibility')
    expect(chat.weatherCard.uvIndex).toBe('UV Index')
  })

  it('has the weatherForecast keys', () => {
    expect(chat.weatherForecast.temperatureRange).toBe('🌡️ Temperature range')
    expect(chat.weatherForecast.cold).toBe('❄️ Cold')
    expect(chat.weatherForecast.hot).toBe('🔥 Hot')
    expect(chat.weatherForecast.sunrise).toBe('Sunrise')
    expect(chat.weatherForecast.sunset).toBe('Sunset')
  })
})

describe('chat namespace tool-card CLDR plural resolves via the real i18next instance', () => {
  it('picks the singular/plural form for deepResearchCard.completedSummary', async () => {
    const { i18n, i18nReady } = await import('@/lib/i18n')
    await i18nReady
    expect(
      i18n.t('chat:deepResearchCard.completedSummary', {
        minutes: 4,
        count: 1
      })
    ).toBe('Research completed in 4m · 1 source')
    expect(
      i18n.t('chat:deepResearchCard.completedSummary', {
        minutes: 4,
        count: 7
      })
    ).toBe('Research completed in 4m · 7 sources')
  })
})
```

- [ ] **Step 4: Run the new tests**

Run: `npx vitest run tests/unit/i18n/chat-namespace.test.ts`
Expected: PASS (all assertions green, including the pre-existing ones from
`chat-core` — this file is being extended, not replaced).

- [ ] **Step 5: Commit**

```bash
git add src/shared/i18n/locales/en/chat.json tests/unit/i18n/chat-namespace.test.ts
git commit -m "feat(i18n): populate chat.json tool-card keys + extend catalog test"
```

---

### Task 2: Artifact card (`artifact-card.tsx`)

**Files:**

- Modify: `src/renderer/components/calling-tools/artifact/artifact-card.tsx`

**Interfaces:**

- Consumes: `chat:artifactCard.*` keys from Task 1.
- No exported signature changes — `ArtifactCard`, `UrlPill`,
  `FullscreenButton`, `InlineChromeBar`, `FullscreenChromeBar` all keep
  their exact current prop types.

This file has 2 separate function components each owning their own
literals (`UrlPill`, `FullscreenButton`) — each needs its own
`useTranslation('chat')` call.

- [ ] **Step 1: Rewrite `src/renderer/components/calling-tools/artifact/artifact-card.tsx` in full**

```typescript
import { artifactShortId, artifactSlug } from '@shared/utils/artifact-slug'
import { MaximizeIcon, MinimizeIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import {
  checkFullScreen,
  revealArtifactFile,
  subscribeFullScreenChanged,
  unsubscribeFullScreenChanged
} from '@/lib/ipc'
import { cn } from '@/lib/utils'

interface ArtifactDetails {
  type: 'artifact'
  title: string
  code: string
  artifactId: string
}

function getArtifactSandboxUrl(): string {
  const devUrl = import.meta.env.ELECTRON_RENDERER_URL as string | undefined
  if (import.meta.env.DEV && devUrl) {
    return `${devUrl}/sub-apps/artifacts/index.html`
  }
  return '../sub-apps/artifacts/index.html'
}

function sendToIframe(
  iframe: HTMLIFrameElement | null,
  code: string,
  title: string
) {
  const win = iframe?.contentWindow
  if (!win || !code) return
  const theme = window.localStorage.getItem('vite-ui-theme') ?? 'system'
  win.postMessage({ type: 'theme', theme }, '*')
  win.postMessage({ type: 'render', code, artifactId: title }, '*')
}

/** Track whether the Electron window is in macOS native fullscreen. */
function useIsNativeFullscreen() {
  const [isFs, setIsFs] = useState(false)

  useEffect(() => {
    checkFullScreen().then((v: boolean) => setIsFs(v))
    const handler = (_: unknown, v: boolean) => setIsFs(v)
    subscribeFullScreenChanged(handler)
    return () => unsubscribeFullScreenChanged(handler)
  }, [])

  return isFs
}

const TRAFFIC_LIGHT_COLORS = ['#ff5f57', '#febc2e', '#28c840']

function DecorativeTrafficLights() {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      {TRAFFIC_LIGHT_COLORS.map((color) => (
        <span
          key={color}
          className="h-3 w-3 rounded-full"
          style={{
            backgroundColor: color,
            boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.12)'
          }}
        />
      ))}
    </div>
  )
}

function UrlPill({
  title,
  artifactId,
  chatId
}: {
  title: string
  artifactId: string
  chatId: string
}) {
  const { t } = useTranslation('chat')
  const slug = artifactSlug(title)
  const shortId = artifactShortId(artifactId)

  const handleClick = async () => {
    const result = (await revealArtifactFile(chatId, artifactId)) as
      | { ok: true; filePath: string }
      | { ok: false; reason: string }
      | undefined
    if (result && !result.ok) {
      sileo.error({
        title: t('artifactCard.cannotOpenTitle'),
        description:
          result.reason === 'not-found'
            ? t('artifactCard.missingFileDescription')
            : t('artifactCard.resolveFailedDescription')
      })
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={t('artifactCard.revealAriaLabel', { title })}
      title={t('artifactCard.revealTitle')}
      className={cn(
        'min-w-0 max-w-160 flex-1 rounded-md border px-2.5 py-1 text-left font-mono text-[11.5px] leading-none',
        'border-border/60 bg-background text-muted-foreground transition-colors',
        'hover:bg-muted cursor-pointer'
      )}
    >
      <span className="mr-1 opacity-60">🔒</span>
      <span className="text-foreground/50">artifact://</span>
      <span className="truncate">
        {shortId}/{slug}
      </span>
    </button>
  )
}

function FullscreenButton({
  isFullscreen,
  onClick
}: {
  isFullscreen: boolean
  onClick: () => void
}) {
  const { t } = useTranslation('chat')
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t(
        isFullscreen ? 'artifactCard.exitFullscreen' : 'artifactCard.enterFullscreen'
      )}
      title={t(
        isFullscreen ? 'artifactCard.exitFullscreenEsc' : 'artifactCard.fullscreen'
      )}
      className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      {isFullscreen ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
    </button>
  )
}

function InlineChromeBar({
  title,
  artifactId,
  chatId,
  onEnterFullscreen
}: {
  title: string
  artifactId: string
  chatId: string
  onEnterFullscreen: () => void
}) {
  return (
    <div className="bg-muted/70 flex h-10 items-center gap-3 border-b px-3">
      <DecorativeTrafficLights />
      <div className="flex min-w-0 flex-1 justify-center">
        <UrlPill title={title} artifactId={artifactId} chatId={chatId} />
      </div>
      <FullscreenButton isFullscreen={false} onClick={onEnterFullscreen} />
    </div>
  )
}

function FullscreenChromeBar({
  title,
  artifactId,
  chatId,
  isNativeFullscreen,
  onExitFullscreen
}: {
  title: string
  artifactId: string
  chatId: string
  isNativeFullscreen: boolean
  onExitFullscreen: () => void
}) {
  // When Electron is NOT in macOS native fullscreen, the OS traffic lights sit
  // at the top-left of our window — pad our chrome content to 88px to avoid
  // collision. When native-fullscreen, the OS lights move into the menu bar so
  // we can start at normal padding.
  const leftPadding = isNativeFullscreen ? 16 : 88

  return (
    <div
      className="bg-muted/70 flex h-10 items-center gap-3 border-b pr-3"
      style={{ paddingLeft: leftPadding }}
    >
      <div className="flex min-w-0 flex-1 justify-center">
        <UrlPill title={title} artifactId={artifactId} chatId={chatId} />
      </div>
      <FullscreenButton isFullscreen={true} onClick={onExitFullscreen} />
    </div>
  )
}

export function ArtifactCard({
  chatId,
  toolResult
}: {
  chatId: string
  toolResult: ArtifactDetails
}) {
  const inlineIframeRef = useRef<HTMLIFrameElement>(null)
  const fullscreenIframeRef = useRef<HTMLIFrameElement>(null)
  const inlineReady = useRef(false)
  const fullscreenReady = useRef(false)
  const codeRef = useRef(toolResult.code)
  const titleRef = useRef(toolResult.title)
  const [expanded, setExpanded] = useState(false)
  const isNativeFullscreen = useIsNativeFullscreen()

  // Keep refs current so the message listener (attached once) always reads
  // the latest code/title when responding to a sandbox ready handshake.
  useEffect(() => {
    codeRef.current = toolResult.code
    titleRef.current = toolResult.title
  }, [toolResult.code, toolResult.title])

  // Listen for the sandbox ready handshake from each iframe and send the
  // render message in response. Fixes a race where the parent's `onLoad`
  // fired before the sandbox attached its message listener, dropping the
  // initial render message and stranding the UI on "Waiting for artifact…".
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        typeof event.data !== 'object' ||
        event.data === null ||
        (event.data as { type?: unknown }).type !== 'artifact-sandbox-ready'
      ) {
        return
      }
      if (event.source === inlineIframeRef.current?.contentWindow) {
        inlineReady.current = true
        sendToIframe(inlineIframeRef.current, codeRef.current, titleRef.current)
      } else if (event.source === fullscreenIframeRef.current?.contentWindow) {
        fullscreenReady.current = true
        sendToIframe(
          fullscreenIframeRef.current,
          codeRef.current,
          titleRef.current
        )
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Re-send on streaming code/title updates (iframes already mounted).
  useEffect(() => {
    if (inlineReady.current) {
      sendToIframe(inlineIframeRef.current, toolResult.code, toolResult.title)
    }
  }, [toolResult.code, toolResult.title])

  useEffect(() => {
    if (fullscreenReady.current && expanded) {
      sendToIframe(
        fullscreenIframeRef.current,
        toolResult.code,
        toolResult.title
      )
    }
  }, [toolResult.code, toolResult.title, expanded])

  useEffect(() => {
    if (!expanded) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Reset ready flag on exit so the next mount's handshake re-triggers a render.
        fullscreenReady.current = false
        setExpanded(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [expanded])

  return (
    <>
      <div
        className="border-border/70 bg-card overflow-hidden rounded-lg border shadow-sm"
        style={expanded ? { display: 'none' } : undefined}
      >
        <InlineChromeBar
          title={toolResult.title}
          artifactId={toolResult.artifactId}
          chatId={chatId}
          onEnterFullscreen={() => setExpanded(true)}
        />
        <iframe
          ref={inlineIframeRef}
          src={getArtifactSandboxUrl()}
          className="w-full border-0"
          style={{ height: '400px' }}
          sandbox="allow-scripts allow-same-origin"
          title={toolResult.title}
        />
      </div>

      {expanded &&
        createPortal(
          <div className="bg-background fixed inset-0 z-50 flex flex-col">
            <FullscreenChromeBar
              title={toolResult.title}
              artifactId={toolResult.artifactId}
              chatId={chatId}
              isNativeFullscreen={isNativeFullscreen}
              onExitFullscreen={() => {
                // Reset ready flag so the next mount's handshake re-triggers a render.
                fullscreenReady.current = false
                setExpanded(false)
              }}
            />
            <iframe
              ref={fullscreenIframeRef}
              src={getArtifactSandboxUrl()}
              className="w-full flex-1 border-0"
              sandbox="allow-scripts allow-same-origin"
              title={toolResult.title}
            />
          </div>,
          document.body
        )}
    </>
  )
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck:web && pnpm lint && pnpm format:check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/calling-tools/artifact/artifact-card.tsx
git commit -m "feat(i18n): wire chat namespace into the artifact card"
```

---

### Task 3: Computer-use card (`computer-use-card.tsx`)

**Files:**

- Modify: `src/renderer/components/calling-tools/computer-use/computer-use-card.tsx`

**Interfaces:**

- Consumes: `chat:computerUseCard.*` keys from Task 1, including the
  `outcome.*` sub-object addressed via a dynamic template-literal key.
- No exported signature changes — `ComputerUseCard`'s props are untouched.

This is the most structurally involved file in this plan: `headerRight`'s
derivation combines 4 different translated cases, and `details.outcome` is
looked up dynamically (`` `computerUseCard.outcome.${details.outcome}` ``).
`details.outcome`'s type is the literal union
`'success' | 'failed' | 'aborted' | 'abandoned' | 'stuck'`, so TypeScript
can compute the full set of resulting key strings automatically —
`ParseKeys` should accept this without a cast, matching this project's
established preference (no `as never` unless proven necessary). If
`pnpm typecheck:web` genuinely rejects the dynamic template literal, the
fallback is `t(`computerUseCard.outcome.${details.outcome}` as never)` —
try without the cast first and report which one was needed.

- [ ] **Step 1: Rewrite `src/renderer/components/calling-tools/computer-use/computer-use-card.tsx` in full**

```typescript
import { TEST_IDS } from '@shared/constants/test-ids'
import { MonitorIcon, OctagonXIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { abortComputerUse, answerComputerUse } from '@/services/computer-use'

/**
 * The shape `ComputerUseCard` receives as `toolResult` — `messages-calling-tools`
 * unwraps `details` before passing it in. It is either a live `SessionUpdate`
 * frame streamed via `onUpdate` (`{ step, action?, thumbnail?, awaitingHuman?,
 * sessionId }`) or the terminal result (`{ sessionId, outcome, steps, summary }`).
 * Every field is optional so a half-populated frame renders without guards.
 */
interface ComputerUseDetails {
  step?: number
  action?: string
  thumbnail?: string
  awaitingHuman?: { question: string }
  outcome?: 'success' | 'failed' | 'aborted' | 'abandoned' | 'stuck'
  sessionId?: string
  steps?: number
  summary?: string
  error?: string
}

const OUTCOME_TONE: Record<string, string> = {
  success: 'text-green-500',
  failed: 'text-destructive',
  aborted: 'text-muted-foreground',
  abandoned: 'text-muted-foreground',
  stuck: 'text-yellow-600 dark:text-yellow-400'
}

export function ComputerUseCard({
  toolResult
}: {
  toolResult: ComputerUseDetails | null | undefined
}) {
  const { t } = useTranslation('chat')
  const details = toolResult ?? {}
  const [answer, setAnswer] = useState('')
  const running = !details.outcome && !details.error

  const stop = () => {
    abortComputerUse().catch(() => {
      sileo.error({
        title: t('computerUseCard.stopFailedTitle'),
        description: t('computerUseCard.stopFailedDescription')
      })
    })
  }

  const sendAnswer = () => {
    if (!details.sessionId) return
    answerComputerUse(details.sessionId, answer.trim() || '(done)').catch(
      () => {
        sileo.error({
          title: t('computerUseCard.answerFailedTitle'),
          description: t('computerUseCard.answerFailedDescription')
        })
      }
    )
    setAnswer('')
  }

  const headerRight = details.error
    ? t('computerUseCard.error')
    : details.outcome
      ? t(`computerUseCard.outcome.${details.outcome}`)
      : typeof details.step === 'number'
        ? t('computerUseCard.stepBadge', { step: details.step })
        : t('computerUseCard.running')

  return (
    <div className="overflow-hidden rounded-lg border text-xs">
      {/* Header */}
      <div className="bg-muted/60 flex items-center gap-2 border-b px-3 py-2">
        <MonitorIcon className="text-muted-foreground size-3.5 shrink-0" />
        <span className="text-foreground/80 flex-1 truncate font-medium">
          {t('computerUseCard.title')}
        </span>
        <span
          className={cn(
            'shrink-0',
            details.outcome
              ? (OUTCOME_TONE[details.outcome] ?? 'text-muted-foreground')
              : 'text-muted-foreground'
          )}
        >
          {headerRight}
        </span>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2">
        {/* Current / last step + action */}
        {typeof details.step === 'number' && (
          <div className="text-foreground/90">
            {details.action
              ? t('computerUseCard.stepWithAction', {
                  step: details.step,
                  action: details.action
                })
              : t('computerUseCard.stepNoAction', { step: details.step })}
          </div>
        )}

        {/* Optional thumbnail of the target window */}
        {details.thumbnail && (
          <div className="bg-muted/40 max-h-40 w-fit overflow-hidden rounded border">
            <img
              src={`data:image/png;base64,${details.thumbnail}`}
              alt={t('computerUseCard.targetWindowAlt', {
                step: details.step ?? '?'
              })}
              className="max-h-40 w-auto object-contain"
            />
          </div>
        )}

        {/* Inline askHuman prompt */}
        {details.awaitingHuman && (
          <div className="border-primary/30 bg-primary/5 flex flex-col gap-2 rounded-md border p-2">
            <p className="text-foreground/90">
              {details.awaitingHuman.question}
            </p>
            {details.sessionId ? (
              <div className="flex items-center gap-2">
                <Input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') sendAnswer()
                  }}
                  placeholder={t('computerUseCard.replyPlaceholder')}
                  className="h-7 flex-1 text-xs"
                />
                <Button
                  size="xs"
                  variant="secondary"
                  data-testid={TEST_IDS.computerUse.continueButton}
                  onClick={sendAnswer}
                >
                  {t('computerUseCard.doneContinue')}
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground">
                {t('computerUseCard.waitingForReply')}
              </p>
            )}
          </div>
        )}

        {/* Stop control while the session is live */}
        {running && (
          <div>
            <Button
              size="xs"
              variant="destructive"
              data-testid={TEST_IDS.computerUse.stopButton}
              onClick={stop}
            >
              <OctagonXIcon />
              {t('computerUseCard.stop')}
            </Button>
          </div>
        )}

        {/* Terminal summary */}
        {!running && (
          <>
            {details.summary && (
              <p className="text-foreground/90">{details.summary}</p>
            )}
            {details.error && (
              <p className="text-destructive">{details.error}</p>
            )}
            {details.sessionId && (
              <p className="text-muted-foreground/60 font-mono text-[10px]">
                {t('computerUseCard.session', {
                  sessionId: details.sessionId
                })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck:web && pnpm lint && pnpm format:check`
Expected: PASS. Pay specific attention to the `t(`computerUseCard.outcome.${details.outcome}`)`
line — confirm it compiles without a cast; if it doesn't, apply the
`as never` fallback described above and note which path was needed.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/calling-tools/computer-use/computer-use-card.tsx
git commit -m "feat(i18n): wire chat namespace into the computer-use card"
```

---

### Task 4: Deep-research card (`deep-research-card.tsx`)

**Files:**

- Modify: `src/renderer/components/calling-tools/deep-research/deep-research-card.tsx`

**Interfaces:**

- Consumes: `chat:deepResearchCard.*` keys from Task 1 (incl. the
  `completedSummary` CLDR plural pair).
- No exported signature changes — `DeepResearchCard`'s props untouched;
  `prepareMarkdownForPdf`'s signature (`(markdown, webSources) => string`)
  unchanged, still a plain exported function.

`prepareMarkdownForPdf` is a plain, non-component, non-hook function — its
one literal uses the raw `i18n` singleton, not `useTranslation()`.

- [ ] **Step 1: Rewrite `src/renderer/components/calling-tools/deep-research/deep-research-card.tsx` in full**

```typescript
import { DeepResearch } from '@shared/types/db'
import { WebSearchResult } from '@shared/types/web-search'
import { differenceInMinutes } from 'date-fns'
import { useAtom } from 'jotai'
import { DownloadIcon, LoaderIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'
import useSWR from 'swr'

import { Markdown } from '@/components/markdown'
import { ShimmeringText } from '@/components/shimmering-text'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { i18n } from '@/lib/i18n'
import { downloadFile } from '@/lib/utils'
import { markdownToPdf } from '@/services/tools'
import { activeDeepResearchIdAtom } from '@/stores/chat'

/**
 * Convert inline 【N-source】 markers to superscript [N] and append a
 * numbered References section — suitable for PDF rendering. This is a
 * plain helper (not a component or hook), so translated text uses the
 * shared `i18n` singleton directly rather than `useTranslation()`.
 */
function prepareMarkdownForPdf(
  markdown: string,
  webSources: WebSearchResult[]
): string {
  const citationRegex = /【([\d,\s]+)-source】/g

  // Collect citation ranks in order of first appearance (deduplicated)
  const seenRanks = new Set<number>()
  const orderedRanks: number[] = []
  for (const match of markdown.matchAll(citationRegex)) {
    for (const part of match[1].split(',')) {
      const n = parseInt(part.trim(), 10)
      if (!isNaN(n) && !seenRanks.has(n)) {
        seenRanks.add(n)
        orderedRanks.push(n)
      }
    }
  }

  // Replace markers with superscript HTML (MarkdownIt passes inline HTML through)
  const processed = markdown.replace(citationRegex, (_, numsStr: string) => {
    return numsStr
      .split(',')
      .map((p) => parseInt(p.trim(), 10))
      .filter((n) => !isNaN(n))
      .map((n) => `<sup>[${n}]</sup>`)
      .join('')
  })

  if (orderedRanks.length === 0) return processed

  // Build a numbered References list
  const refLines = orderedRanks.map((rank) => {
    const source = webSources.find((s) => s.rank === rank)
    if (!source) return i18n.t('chat:deepResearchCard.unknownSource', { rank })
    let hostname = ''
    try {
      hostname = new URL(source.link).hostname
    } catch {
      hostname = source.link
    }
    return `[${rank}] **${source.title}** (${hostname})  \n    <${source.link}>`
  })

  return `${processed}\n\n---\n\n## References\n\n${refLines.join('\n\n')}`
}

export function DeepResearchCard({
  toolResult
}: {
  toolResult: Pick<DeepResearch, 'id' | 'toolCallId'>
}) {
  const { t } = useTranslation('chat')
  const [loading, setLoading] = useState(false)
  const [activeDeepResearchId, setActiveDeepResearchId] = useAtom(
    activeDeepResearchIdAtom
  )

  const { data: deepResearchResult } = useSWR<DeepResearch>(
    `/api/deep-research/result/${toolResult.id}`
  )

  const handleActiveDeepResearchSseId = () => {
    if (activeDeepResearchId) {
      setActiveDeepResearchId('')
    } else {
      setActiveDeepResearchId(toolResult.id)
    }
  }

  const exportPdf = async () => {
    if (!deepResearchResult?.finalReport) return

    try {
      setLoading(true)
      const pdfMarkdown = prepareMarkdownForPdf(
        deepResearchResult.finalReport,
        deepResearchResult.webSources ?? []
      )
      const blob = await markdownToPdf(pdfMarkdown)
      downloadFile(blob, `${deepResearchResult.id}.pdf`)
    } catch (e) {
      sileo.error({
        title: t('deepResearchCard.exportFailedTitle'),
        description:
          e instanceof Error
            ? e.message
            : t('deepResearchCard.exportFailedDescription')
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (deepResearchResult?.jobStatus === 'streaming') {
      setActiveDeepResearchId(toolResult.id)
    }

    return () => {
      setActiveDeepResearchId('')
    }
  }, [
    deepResearchResult,
    setActiveDeepResearchId,
    toolResult.id,
    toolResult.toolCallId
  ])

  return (
    <section>
      <div className="flex items-center justify-between">
        <Button
          variant={
            activeDeepResearchId === toolResult.id ? 'secondary' : 'ghost'
          }
          className="font-semibold"
          onClick={handleActiveDeepResearchSseId}
        >
          {deepResearchResult?.jobStatus === 'streaming' && (
            <ShimmeringText text={t('deepResearchCard.researching')} />
          )}
          {deepResearchResult?.jobStatus === 'archived' &&
            deepResearchResult?.endTime && (
              <div>
                {t('deepResearchCard.completedSummary', {
                  minutes: differenceInMinutes(
                    deepResearchResult?.endTime,
                    deepResearchResult?.startTime
                  ),
                  count: deepResearchResult?.webSources?.length ?? 0
                })}
              </div>
            )}
        </Button>

        {!!deepResearchResult?.finalReport && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('deepResearchCard.exportAriaLabel')}
                  onClick={exportPdf}
                >
                  {loading ? (
                    <LoaderIcon
                      size={14}
                      strokeWidth={2.5}
                      className="animate-spin"
                    />
                  ) : (
                    <DownloadIcon />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-60">
                  {t('deepResearchCard.downloadPdfTooltip')}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {deepResearchResult?.finalReport ? (
        <Card className="mt-4 p-4">
          <Markdown
            src={deepResearchResult?.finalReport}
            webSearchResults={deepResearchResult.webSources ?? undefined}
          />
        </Card>
      ) : null}
    </section>
  )
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck:web && pnpm lint && pnpm format:check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/calling-tools/deep-research/deep-research-card.tsx
git commit -m "feat(i18n): wire chat namespace into the deep-research card"
```

---

### Task 5: Draw.io card (`drawio-card.tsx`)

**Files:**

- Modify: `src/renderer/components/calling-tools/drawio/drawio-card.tsx`

**Interfaces:**

- Consumes: `chat:drawioCard.*` keys from Task 1.
- No exported signature changes — `DrawioCard`, `isDrawioOutput`,
  `DrawioToolOutput` all untouched.

- [ ] **Step 1: Rewrite `src/renderer/components/calling-tools/drawio/drawio-card.tsx` in full**

```typescript
import { ExternalLinkIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

/**
 * Output shape returned by the draw.io MCP servers (both the local
 * `@drawio/mcp` Tool Server and the hosted `mcp.draw.io/mcp` App Server).
 * Either `mermaid`, `xml`, or `csv` carries the diagram source. The `_version`
 * tag (e.g. `drawio-mcp-2026-05-06T...`) is what we use to identify the
 * payload as a draw.io tool result regardless of the calling tool name.
 */
export interface DrawioToolOutput {
  mermaid?: string | null
  xml?: string | null
  csv?: string | null
  _version?: string
}

// Mermaid diagram headers (optionally preceded by an `%%{init …}%%` directive).
const MERMAID_START_RE =
  /^\s*(?:%%\{[\s\S]*?\}%%\s*)?(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture-beta)\b/

const DRAWIO_XML_START_RE = /^\s*<(?:\?xml|mxfile|mxGraphModel|diagram)\b/i

export function isDrawioOutput(output: unknown): output is DrawioToolOutput {
  if (!output || typeof output !== 'object') return false
  const o = output as Record<string, unknown>
  const mermaid = typeof o.mermaid === 'string' ? o.mermaid : null
  const xml = typeof o.xml === 'string' ? o.xml : null
  const csv = typeof o.csv === 'string' ? o.csv : null
  if (!mermaid && !xml && !csv) return false

  // The App Server tags results `drawio-mcp-…`; trust that outright.
  if (typeof o._version === 'string' && o._version.startsWith('drawio-')) {
    return true
  }
  // Some draw.io MCP servers omit `_version` — sniff the source so a bare
  // `{ mermaid }` / `{ xml }` payload still gets the canvas instead of being
  // dumped as raw JSON by GenericToolCard. `csv` alone is too ambiguous.
  if (mermaid && MERMAID_START_RE.test(mermaid)) return true
  if (xml && DRAWIO_XML_START_RE.test(xml)) return true
  return false
}

type DiagramFormat = 'mermaid' | 'xml' | 'csv'

function pickSource(
  output: DrawioToolOutput
): { format: DiagramFormat; data: string } | null {
  if (output.mermaid) return { format: 'mermaid', data: output.mermaid }
  if (output.xml) return { format: 'xml', data: output.xml }
  if (output.csv) return { format: 'csv', data: output.csv }
  return null
}

/**
 * `embed=1&proto=json` puts draw.io into postMessage mode: the iframe sends
 * `{event: 'init'}` once it's ready, after which we send a `load` action with
 * the diagram source. This avoids URL-length limits and works identically for
 * mermaid/xml/csv. `ui=min&spin=1` strips the editor chrome down to a viewer
 * with a small loading spinner; toolbar/menus stay accessible if the user
 * wants to edit. Keep `libraries=0&saveAndExit=0` so the iframe doesn't try
 * to phone home for shape libraries we won't use here. `dark=` is read on
 * iframe load only — re-mount via React `key` when the app theme flips.
 */
function buildEmbedUrl(dark: boolean): string {
  return `https://embed.diagrams.net/?embed=1&proto=json&ui=min&spin=1&libraries=0&saveAndExit=0&noSaveBtn=1&noExitBtn=1&dark=${dark ? 1 : 0}`
}

export function DrawioCard({ output }: { output: DrawioToolOutput }) {
  const { t } = useTranslation('chat')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [error, setError] = useState<string | null>(null)
  const source = pickSource(output)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  useEffect(() => {
    if (!source) return
    const handler = (e: MessageEvent) => {
      // Only react to messages from our iframe (origin is embed.diagrams.net,
      // but contentWindow comparison is the strict check).
      if (e.source !== iframeRef.current?.contentWindow) return
      let data: { event?: string } | null = null
      try {
        data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      } catch {
        return
      }
      if (!data?.event) return
      if (data.event === 'init') {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({
            action: 'load',
            autosave: 0,
            descriptor: { format: source.format, data: source.data }
          }),
          '*'
        )
      } else if (data.event === 'configure') {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ action: 'configure' }),
          '*'
        )
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [source])

  if (!source) {
    return (
      <div className="text-muted-foreground rounded-lg border p-3 text-xs">
        {t('drawioCard.noSource')}
      </div>
    )
  }

  // The hosted draw.io editor opens any diagram passed via the `#R<base64>`
  // fragment for XML, but mermaid/csv require the `#create=` JSON fragment.
  // Build a `create` URL for the "Open in draw.io" button so the user can pop
  // out the same diagram into the full editor.
  const openUrl = (() => {
    const payload = {
      type: source.format,
      compressed: false,
      data: source.data
    }
    return `https://app.diagrams.net/?ui=min#create=${encodeURIComponent(JSON.stringify(payload))}`
  })()

  return (
    <div className="bg-card overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="text-muted-foreground text-xs font-medium">
          draw.io · {source.format}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          render={
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('drawioCard.openInDrawio')}
            />
          }
        >
          {t('drawioCard.openInDrawio')}
          <ExternalLinkIcon className="ml-1 size-3" />
        </Button>
      </div>
      <iframe
        // Re-mount on theme switch so drawio re-reads the `dark` query param
        // — drawio doesn't support runtime theme changes via postMessage.
        key={isDark ? 'dark' : 'light'}
        ref={iframeRef}
        src={buildEmbedUrl(isDark)}
        title={t('drawioCard.iframeTitle')}
        onError={() => setError(t('drawioCard.loadFailed'))}
        className="block h-[420px] w-full"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />
      {error && (
        <p className="text-destructive border-t px-3 py-2 text-xs">{error}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck:web && pnpm lint && pnpm format:check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/calling-tools/drawio/drawio-card.tsx
git commit -m "feat(i18n): wire chat namespace into the drawio card"
```

---

### Task 6: Generic tool card + a bonus drive-by fix

**Files:**

- Modify: `src/renderer/components/calling-tools/generic-tool-card.tsx`
- Modify: `src/renderer/components/messages-calling-tools.tsx`

**Interfaces:**

- Consumes: `chat:genericToolCard.*` keys from Task 1.
- `messages-calling-tools.tsx` is NOT under `calling-tools/` (it's this
  plan's one exception to the directory scope) — it's included here only
  for a single, already-diagnosed, one-line drive-by fix: it has an
  identical hardcoded `'Tool'` fallback to `generic-tool-card.tsx`'s
  (flagged as a deferred Minor finding in the `chat-core` plan's final
  review) — this task closes it out by reusing the exact same
  `genericToolCard.fallbackLabel` key rather than creating a duplicate.
  That file already has `useTranslation('chat')` from `chat-core`'s own
  work — no new import needed there.

- [ ] **Step 1: Rewrite `src/renderer/components/calling-tools/generic-tool-card.tsx` in full**

```typescript
import { capitalCase } from 'change-case'
import { ChevronRightIcon, WrenchIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Fallback card for tool results we don't have a dedicated renderer for —
 * primarily MCP tools (drawio, github, slack, …) whose names aren't in the
 * built-in dispatch list. Without this the tool appears to "do nothing" in
 * the UI, even though the LLM saw the result. We show the tool name and let
 * the user expand to inspect the raw payload.
 */
export function GenericToolCard({
  toolName,
  output
}: {
  toolName: string
  output: unknown
}) {
  const { t } = useTranslation('chat')
  const [open, setOpen] = useState(false)
  const label = toolName ? capitalCase(toolName) : t('genericToolCard.fallbackLabel')

  const pretty =
    typeof output === 'string'
      ? output
      : output == null
        ? ''
        : (() => {
            try {
              return JSON.stringify(output, null, 2)
            } catch {
              return String(output)
            }
          })()

  return (
    <div className="bg-card overflow-hidden rounded-lg border text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-accent/40 flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <WrenchIcon className="text-muted-foreground size-3.5 shrink-0" />
        <span className="font-medium">{label}</span>
        <Badge variant="secondary" className="text-[10px]">
          {t('genericToolCard.badge')}
        </Badge>
        <ChevronRightIcon
          className={cn(
            'text-muted-foreground ml-auto size-3.5 shrink-0 transition-transform',
            open && 'rotate-90'
          )}
        />
      </button>
      {open && pretty && (
        <pre className="bg-muted/30 max-h-72 max-w-full overflow-auto border-t px-3 py-2 font-mono text-[11px] leading-snug [overflow-wrap:anywhere] whitespace-pre-wrap">
          {pretty}
        </pre>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Fix `messages-calling-tools.tsx`'s identical `'Tool'` fallback**

Before editing, re-read this file live and confirm the exact current line
(it already has `const { t } = useTranslation('chat')` in `CallingTools`,
from the `chat-core` plan). Find:

```typescript
const toolLabel = toolName ? capitalCase(toolName) : 'Tool'
```

Replace with:

```typescript
const toolLabel = toolName
  ? capitalCase(toolName)
  : t('genericToolCard.fallbackLabel')
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck:web && pnpm lint && pnpm format:check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/calling-tools/generic-tool-card.tsx src/renderer/components/messages-calling-tools.tsx
git commit -m "feat(i18n): wire chat namespace into the generic tool card + fix its duplicate fallback in messages-calling-tools"
```

---

### Task 7: Map itinerary card + place detail panel

**Files:**

- Modify: `src/renderer/components/calling-tools/map-itinerary/itinerary-card.tsx`
- Modify: `src/renderer/components/calling-tools/map-itinerary/place-detail.tsx`

**Interfaces:**

- Consumes: `chat:mapItineraryCard.*` and `chat:placeDetail.*` keys from
  Task 1.
- No exported signature changes. `day-layer.tsx` and `types.ts` (siblings
  in the same directory) need ZERO changes — confirmed to have no
  translatable literals — do not touch either file in this task.

- [ ] **Step 1: Rewrite `src/renderer/components/calling-tools/map-itinerary/itinerary-card.tsx` in full**

```typescript
import type { ToolNotice } from '@shared/types/chat'
import { APIProvider, Map } from '@vis.gl/react-google-maps'
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  InfoIcon,
  TriangleAlertIcon
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useClipboard } from '@/hooks/use-clipboard'
import { useSettings } from '@/hooks/use-settings'
import { cn } from '@/lib/utils'

import { DayLayer, FocusedPlaceContext } from './day-layer'
import { PlaceDetail } from './place-detail'
import type { ItineraryDay, MapItineraryDetails } from './types'

const MODE_TO_GMAPS_PARAM: Record<
  NonNullable<ItineraryDay['routeMode']>,
  string
> = {
  walking: 'walking',
  driving: 'driving',
  transit: 'transit'
}

// Map static props hoisted to module scope so they don't allocate fresh
// objects on every render — saves React from comparing identity-different
// but value-equal objects, and makes it obvious these are inert.
const MAP_DEFAULT_CENTER = { lat: 0, lng: 0 }
const MAP_DEFAULT_ZOOM = 2
const MAP_LIBRARIES: ['geometry'] = ['geometry']
const MAP_ID = 'actovia-itinerary'

/** Build a Google Maps deep-link that opens the day's route with all
 *  waypoints in order. */
function buildGoogleMapsUrl(day: ItineraryDay): string | null {
  const places = day.places
  if (places.length === 0) return null
  if (places.length === 1) {
    const p = places[0]
    return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
  }
  const origin = places[0]
  const destination = places[places.length - 1]
  const waypoints = places.slice(1, -1)
  const url = new URL('https://www.google.com/maps/dir/')
  url.searchParams.set('api', '1')
  url.searchParams.set('origin', `${origin.lat},${origin.lng}`)
  url.searchParams.set('destination', `${destination.lat},${destination.lng}`)
  if (waypoints.length > 0) {
    url.searchParams.set(
      'waypoints',
      waypoints.map((p) => `${p.lat},${p.lng}`).join('|')
    )
  }
  url.searchParams.set(
    'travelmode',
    MODE_TO_GMAPS_PARAM[day.routeMode ?? 'walking']
  )
  return url.toString()
}

/** Markdown summary of a day for the Copy button — pastes into another
 *  chat / notes app preserving structure. */
function buildDayMarkdown(day: ItineraryDay): string {
  const header = `## ${day.label}${day.title ? ` — ${day.title}` : ''}`
  const summary = day.summary ? `\n${day.summary}\n` : ''
  const places = day.places
    .map((p, i) => {
      const lines: string[] = []
      lines.push(`${i + 1}. **${p.name}**`)
      const meta: string[] = []
      if (p.type) meta.push(p.type)
      if (p.rating !== undefined) meta.push(`★ ${p.rating.toFixed(1)}`)
      if (p.timeLabel) meta.push(p.timeLabel)
      if (meta.length) lines.push(`   ${meta.join(' · ')}`)
      if (p.note) lines.push(`   ${p.note}`)
      if (p.address) lines.push(`   ${p.address}`)
      if (p.phone) lines.push(`   ${p.phone}`)
      if (p.websiteUri) lines.push(`   ${p.websiteUri}`)
      lines.push(
        `   ${p.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`}`
      )
      return lines.join('\n')
    })
    .join('\n\n')
  return `${header}${summary}\n${places}`
}

/** Inner Map subtree, isolated and memoized so interactive parent state
 *  (focused pin, copy-button confirm flash, SWR settings revalidation) never
 *  reaches the map. Its whole prop set is stable for the life of the card:
 *  `apiKey`/`colorScheme` are primitives, `places` is a slice of the frozen
 *  tool result, `onMarkerClick` is a `useCallback([])`. Focus flows to
 *  `DayLayer` through `FocusedPlaceContext` (see day-layer.tsx), so a pin
 *  click re-renders only that layer, not `<APIProvider>` / `<Map>`. */
const MapSurface = memo(function MapSurface({
  apiKey,
  colorScheme,
  places,
  onMarkerClick
}: {
  apiKey: string
  colorScheme: 'LIGHT' | 'DARK'
  places: ItineraryDay['places']
  onMarkerClick: (idx: number) => void
}) {
  return (
    <APIProvider apiKey={apiKey} libraries={MAP_LIBRARIES}>
      <Map
        defaultCenter={MAP_DEFAULT_CENTER}
        defaultZoom={MAP_DEFAULT_ZOOM}
        gestureHandling="greedy"
        disableDefaultUI={true}
        // `disableDefaultUI` doesn't cover the keyboard-shortcuts pill — that's
        // a separate option. (The "Terms" / "Report a map error" / Google
        // attribution is required by the Maps Platform ToS and has no hide flag.)
        keyboardShortcuts={false}
        mapId={MAP_ID}
        colorScheme={colorScheme}
        className="h-full w-full"
      >
        {/* No `key` — a day switch changes `places`, and DayLayer's effects
            already refit bounds and rebuild the polyline on that dep; keying
            forced a full teardown/rebuild of every marker instead. */}
        <DayLayer places={places} onMarkerClick={onMarkerClick} />
      </Map>
    </APIProvider>
  )
})

/** Non-fatal degradation banner — e.g. Places enrichment couldn't run, so the
 *  map renders from the LLM's coordinates but ratings/photos/hours are missing. */
function ItineraryNotice({ notice }: { notice: ToolNotice }) {
  const isInfo = notice.level === 'info'
  const Icon = isInfo ? InfoIcon : TriangleAlertIcon
  return (
    <div
      className={cn(
        'flex items-start gap-2 border-b px-3 py-2 text-xs',
        isInfo
          ? 'border-border/60 bg-muted/40 text-muted-foreground'
          : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400'
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      <span>{notice.message}</span>
    </div>
  )
}

function MapItineraryCardImpl({
  toolResult
}: {
  toolResult: MapItineraryDetails
}) {
  const { t } = useTranslation('chat')
  const { data: settings } = useSettings()
  const { copied, handleCopy } = useClipboard()
  const { resolvedTheme } = useTheme()

  const [activeDayIdx, setActiveDayIdx] = useState(0)
  // Default to the first place of the first day so the detail card is
  // visible from initial render — matches the reference design.
  const [focusedPlaceIdx, setFocusedPlaceIdx] = useState<number | null>(0)

  const activeDay = toolResult.days[activeDayIdx] ?? toolResult.days[0]

  const onSelectDay = useCallback((idx: number) => {
    setActiveDayIdx(idx)
    // Reset to the first place of the new day (not null) so the detail
    // card stays open as the user tabs through days.
    setFocusedPlaceIdx(0)
  }, [])

  const onPrev = useCallback(() => {
    if (!activeDay) return
    setFocusedPlaceIdx((prev) => {
      const total = activeDay.places.length
      if (total === 0) return null
      const current = prev ?? 0
      return (current - 1 + total) % total
    })
  }, [activeDay])

  const onNext = useCallback(() => {
    if (!activeDay) return
    setFocusedPlaceIdx((prev) => {
      const total = activeDay.places.length
      if (total === 0) return null
      const current = prev ?? -1
      return (current + 1) % total
    })
  }, [activeDay])

  // Esc dismisses the detail card.
  useEffect(() => {
    if (focusedPlaceIdx == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocusedPlaceIdx(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedPlaceIdx])

  const onCopy = useCallback(() => {
    if (!activeDay) return
    handleCopy(buildDayMarkdown(activeDay))
  }, [activeDay, handleCopy])

  const onMarkerClick = useCallback((i: number) => setFocusedPlaceIdx(i), [])

  const gmapsUrl = useMemo(
    () => (activeDay ? buildGoogleMapsUrl(activeDay) : null),
    [activeDay]
  )

  const apiKey = settings?.googleCloud?.googleApiKey
  const colorScheme = resolvedTheme === 'dark' ? 'DARK' : 'LIGHT'

  if (!apiKey) {
    return (
      <div className="border-border bg-muted/30 text-muted-foreground rounded-lg border p-4 text-sm">
        {t('mapItineraryCard.missingApiKey')}
      </div>
    )
  }

  if (!activeDay) return null

  const focusedPlace =
    focusedPlaceIdx != null ? activeDay.places[focusedPlaceIdx] : null
  const copyMarkdown = buildDayMarkdown(activeDay)

  return (
    <div className="border-border bg-card relative overflow-hidden rounded-2xl border shadow-sm">
      {toolResult.notice && <ItineraryNotice notice={toolResult.notice} />}
      <div className="relative h-120 w-full">
        <FocusedPlaceContext.Provider value={focusedPlaceIdx}>
          <MapSurface
            apiKey={apiKey}
            colorScheme={colorScheme}
            places={activeDay.places}
            onMarkerClick={onMarkerClick}
          />
        </FocusedPlaceContext.Provider>

        {/* Floating tab strip — only rendered for >1 day. */}
        {toolResult.days.length > 1 && (
          <div
            role="tablist"
            aria-label={t('mapItineraryCard.tabsAriaLabel')}
            className="bg-background/85 absolute top-3 left-3 z-10 flex gap-1 overflow-x-auto rounded-full p-1 shadow-md backdrop-blur"
          >
            {toolResult.days.map((day, i) => {
              const active = i === activeDayIdx
              return (
                <button
                  key={day.label}
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => onSelectDay(i)}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {day.label}
                </button>
              )
            })}
          </div>
        )}

        {/* Per-day actions — only when no detail card is open. */}
        {!focusedPlace && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
            {gmapsUrl && (
              <a
                href={gmapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={t('mapItineraryCard.openRouteTitle')}
                className="bg-background/85 text-foreground hover:bg-background flex size-8 items-center justify-center rounded-full shadow-md backdrop-blur transition-colors"
              >
                <ExternalLinkIcon size={14} />
              </a>
            )}
            <button
              type="button"
              onClick={onCopy}
              title={t('mapItineraryCard.copyMarkdownTitle')}
              className="bg-background/85 text-foreground hover:bg-background flex size-8 items-center justify-center rounded-full shadow-md backdrop-blur transition-colors"
            >
              {copied === copyMarkdown ? (
                <CheckIcon size={14} />
              ) : (
                <CopyIcon size={14} />
              )}
            </button>
          </div>
        )}

        {focusedPlace && focusedPlaceIdx != null && (
          <PlaceDetail
            place={focusedPlace}
            dayLabel={activeDay.label}
            index={focusedPlaceIdx}
            total={activeDay.places.length}
            onPrev={onPrev}
            onNext={onNext}
            onClose={() => setFocusedPlaceIdx(null)}
          />
        )}
      </div>
    </div>
  )
}

// Memoize the whole card so parent re-renders during streaming (the chat
// surface re-renders on every token) don't reach this subtree. Identity is
// NOT enough: the `done` frame and every history reload hand back a fresh,
// value-equal copy of the tool message (SSE is JSON), which would otherwise
// re-initialise the map once per turn end. Fall back to a value check — it
// only runs on the rare identity miss, and an itinerary payload is small.
export const MapItineraryCard = memo(MapItineraryCardImpl, (a, b) => {
  if (a.toolResult === b.toolResult) return true
  return JSON.stringify(a.toolResult) === JSON.stringify(b.toolResult)
})
```

- [ ] **Step 2: Rewrite `src/renderer/components/calling-tools/map-itinerary/place-detail.tsx` in full**

```typescript
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  GlobeIcon,
  MapPinIcon,
  PhoneIcon,
  StarIcon,
  XIcon
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem
} from '@/components/ui/carousel'
import { useSettings } from '@/hooks/use-settings'
import { cn } from '@/lib/utils'

import { buildPlacePhotoUrl, type ItineraryPlace } from './types'

type PlaceDetailProps = {
  place: ItineraryPlace
  dayLabel: string
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}

function formatReviewCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return n.toString()
}

type Tab = 'overview' | 'reviews' | 'hours'

/** Floating overlay on the right side of the map mirroring Claude's
 *  itinerary detail panel: hero photo (carousel if Places returned more),
 *  day/time badge, name, rating, contact info, notes, reviews, hours,
 *  and prev/next pagination. */
export function PlaceDetail({
  place,
  dayLabel,
  index,
  total,
  onPrev,
  onNext,
  onClose
}: PlaceDetailProps) {
  const { t } = useTranslation('chat')
  const { data: settings } = useSettings()
  const apiKey = settings?.googleCloud?.googleApiKey
  const [tab, setTab] = useState<Tab>('overview')
  const [carouselApi, setCarouselApi] = useState<CarouselApi>()
  const [photoIdx, setPhotoIdx] = useState(0)

  const photoUrls = useMemo(() => {
    if (!apiKey || !place.photoNames?.length) return []
    return place.photoNames
      .map((n) => buildPlacePhotoUrl(n, apiKey, 800))
      .filter((u): u is string => !!u)
  }, [apiKey, place.photoNames])

  // Track the carousel's current slide index for the "1/N" counter.
  useEffect(() => {
    if (!carouselApi) return
    setPhotoIdx(carouselApi.selectedScrollSnap())
    const onSelect = () => setPhotoIdx(carouselApi.selectedScrollSnap())
    carouselApi.on('select', onSelect)
    return () => {
      carouselApi.off('select', onSelect)
    }
  }, [carouselApi])

  // Reset internal state when the place changes via prev/next, so a stale
  // photo index or sub-tab doesn't leak into the new place.
  const placeKey = `${place.lat}-${place.lng}-${place.name}`
  const [lastKey, setLastKey] = useState(placeKey)
  if (lastKey !== placeKey) {
    setLastKey(placeKey)
    setTab('overview')
    setPhotoIdx(0)
    // Snap the carousel back to the first slide instantly (no animation,
    // since the place itself just changed underneath).
    carouselApi?.scrollTo(0, true)
  }

  const hasReviews = (place.reviews?.length ?? 0) > 0
  const hasHours = (place.openingHours?.length ?? 0) > 0

  return (
    <div className="border-border bg-card/95 absolute top-3 right-3 bottom-3 z-10 flex w-80 flex-col overflow-hidden rounded-2xl border shadow-xl backdrop-blur">
      {/* Hero — shadcn Carousel cycling through Places photos when we have
          more than one; falls back to a tinted gradient when we have none. */}
      <div className="bg-muted relative h-36 shrink-0 overflow-hidden">
        {photoUrls.length > 0 ? (
          <Carousel
            setApi={setCarouselApi}
            opts={{ loop: photoUrls.length > 1 }}
            className="size-full"
          >
            <CarouselContent className="ml-0">
              {photoUrls.map((url) => (
                <CarouselItem key={url} className="pl-0">
                  <img
                    src={url}
                    alt={place.name}
                    loading="lazy"
                    className="h-36 w-full object-cover"
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
            {photoUrls.length > 1 && (
              // Dot indicators — clickable, active dot widens to a pill.
              // Navigation: swipe / drag / arrow keys / clicking dots.
              <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/45 px-2 py-1 backdrop-blur-sm">
                {photoUrls.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    aria-label={t('placeDetail.goToPhotoAriaLabel', {
                      index: i + 1
                    })}
                    aria-current={i === photoIdx ? 'true' : undefined}
                    onClick={() => carouselApi?.scrollTo(i)}
                    className={cn(
                      'h-1.5 rounded-full bg-white transition-[width,opacity]',
                      i === photoIdx
                        ? 'w-4 opacity-100'
                        : 'w-1.5 opacity-50 hover:opacity-80'
                    )}
                  />
                ))}
              </div>
            )}
          </Carousel>
        ) : (
          <div className="from-primary/20 to-muted size-full bg-gradient-to-br" />
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('placeDetail.closeAriaLabel')}
          className="bg-background/80 text-foreground hover:bg-background absolute top-2 right-2 z-10 flex size-7 items-center justify-center rounded-full shadow-sm backdrop-blur transition-colors"
        >
          <XIcon size={14} />
        </button>
      </div>

      {/* Header strip — day · time, name, rating + type chip */}
      <div className="border-border space-y-1.5 border-b px-4 pt-3 pb-3">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <span>{dayLabel}</span>
          {place.timeLabel && (
            <>
              <span aria-hidden>·</span>
              <span>{place.timeLabel}</span>
            </>
          )}
          {place.openNow !== undefined && (
            <>
              <span aria-hidden>·</span>
              <span
                className={cn(
                  'font-medium',
                  place.openNow
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground'
                )}
              >
                {place.openNow ? t('placeDetail.open') : t('placeDetail.closed')}
              </span>
            </>
          )}
        </div>
        <h3 className="text-foreground text-base leading-tight font-semibold">
          {place.name}
        </h3>
        {(place.rating !== undefined || place.type) && (
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            {place.rating !== undefined && (
              <span className="flex items-center gap-1">
                <span className="text-foreground font-medium">
                  {place.rating.toFixed(1)}
                </span>
                <StarIcon size={11} className="fill-amber-500 text-amber-500" />
                {place.reviewCount !== undefined && (
                  <span>({formatReviewCount(place.reviewCount)})</span>
                )}
              </span>
            )}
            {place.rating !== undefined && place.type && (
              <span aria-hidden>·</span>
            )}
            {place.type && <span>{place.type}</span>}
          </div>
        )}
      </div>

      {/* Tabs — only the Reviews and Hours tabs are gated on whether we have
          that data; Overview is always present. */}
      {(hasReviews || hasHours) && (
        <div
          role="tablist"
          aria-label={t('placeDetail.tabsAriaLabel')}
          className="border-border flex shrink-0 border-b text-xs"
        >
          {/* react-doctor/js-combine-iterations: false positive — literal 3-item array, extra pass is negligible */}
          {(
            [
              { id: 'overview', label: t('placeDetail.tabOverview'), enabled: true },
              { id: 'reviews', label: t('placeDetail.tabReviews'), enabled: hasReviews },
              { id: 'hours', label: t('placeDetail.tabHours'), enabled: hasHours }
            ] as const
          )
            .filter((tabDef) => tabDef.enabled)
            .map((tabDef) => (
              <button
                key={tabDef.id}
                role="tab"
                aria-selected={tab === tabDef.id}
                type="button"
                onClick={() => setTab(tabDef.id)}
                className={cn(
                  'flex-1 px-3 py-2 font-medium transition-colors',
                  tab === tabDef.id
                    ? 'text-foreground border-foreground border-b-2'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tabDef.label}
              </button>
            ))}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {tab === 'overview' && (
          <>
            {place.note && (
              <div className="bg-muted/40 rounded-lg p-2.5">
                <div className="text-muted-foreground mb-1 text-[10px] tracking-widest uppercase">
                  {t('placeDetail.notes')}
                </div>
                <p className="text-foreground text-xs leading-relaxed">
                  {place.note}
                </p>
              </div>
            )}
            <ContactRow
              icon={<MapPinIcon size={12} />}
              text={place.address}
              href={
                place.googleMapsUri ??
                `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`
              }
            />
            <ContactRow
              icon={<PhoneIcon size={12} />}
              text={place.phone}
              href={
                place.phone
                  ? `tel:${place.phone.replace(/\s+/g, '')}`
                  : undefined
              }
              monospace
            />
            <ContactRow
              icon={<GlobeIcon size={12} />}
              text={place.websiteUri?.replace(/^https?:\/\//, '')}
              href={place.websiteUri}
              truncate
            />
          </>
        )}

        {tab === 'reviews' && hasReviews && (
          <div className="space-y-2.5">
            {place.reviews!.map((r) => (
              <article
                key={`${r.author ?? ''}-${r.relativeTime ?? ''}`}
                className="border-border rounded-lg border p-2.5"
              >
                <div className="mb-1 flex items-center gap-2">
                  <ReviewAvatar src={r.authorPhotoUrl} name={r.author} />
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground truncate text-xs font-medium">
                      {r.author ?? t('placeDetail.anonymousReviewer')}
                    </div>
                    <div className="text-muted-foreground flex items-center gap-1 text-[10px]">
                      {r.rating !== undefined && (
                        <span className="flex items-center gap-0.5">
                          {Array.from({ length: 5 }).map((_, j) => (
                            <StarIcon
                              key={j}
                              size={9}
                              className={
                                j < (r.rating ?? 0)
                                  ? 'fill-amber-500 text-amber-500'
                                  : 'text-muted-foreground/40'
                              }
                            />
                          ))}
                        </span>
                      )}
                      {r.relativeTime && <span>{r.relativeTime}</span>}
                    </div>
                  </div>
                </div>
                {r.text && (
                  <p className="text-muted-foreground line-clamp-4 text-xs leading-relaxed">
                    {r.text}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}

        {tab === 'hours' && hasHours && (
          <ul className="space-y-1 text-xs">
            {place.openingHours!.map((line) => {
              const sep = line.indexOf(': ')
              const day = sep >= 0 ? line.slice(0, sep) : line
              const time = sep >= 0 ? line.slice(sep + 2) : ''
              return (
                <li
                  key={line}
                  className="flex items-center justify-between gap-2 py-0.5"
                >
                  <span className="text-foreground font-medium">{day}</span>
                  <span className="text-muted-foreground flex items-center gap-1">
                    <ClockIcon size={10} />
                    {time}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Pagination — circles through the day's places without dismissing
          the card. */}
      <div className="border-border flex items-center justify-between border-t px-2 py-1.5">
        <button
          type="button"
          onClick={onPrev}
          aria-label={t('placeDetail.previousAriaLabel')}
          className={cn(
            'hover:bg-muted text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-md transition-colors',
            total <= 1 && 'pointer-events-none opacity-30'
          )}
          disabled={total <= 1}
        >
          <ChevronLeftIcon size={14} />
        </button>
        <span className="text-muted-foreground text-[11px]">
          {t('placeDetail.pagination', { index: index + 1, total })}
        </span>
        <button
          type="button"
          onClick={onNext}
          aria-label={t('placeDetail.nextAriaLabel')}
          className={cn(
            'hover:bg-muted text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-md transition-colors',
            total <= 1 && 'pointer-events-none opacity-30'
          )}
          disabled={total <= 1}
        >
          <ChevronRightIcon size={14} />
        </button>
      </div>
    </div>
  )
}

/** Reviewer avatar. Google serves author photos from `lh3.googleusercontent.com`,
 *  which rejects a chunk of requests (403 / 429) when they carry a `Referer` it
 *  doesn't expect — so from the Electron renderer's origin many "crack" even
 *  though the same URL opens fine pasted into a browser tab.
 *  `referrerPolicy="no-referrer"` makes Google serve them; a genuinely dead URL
 *  still falls back to the initial. */
function ReviewAvatar({ src, name }: { src?: string; name?: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium">
        {name?.charAt(0)?.toUpperCase() ?? '·'}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="bg-muted size-6 shrink-0 rounded-full object-cover"
    />
  )
}

function ContactRow({
  icon,
  text,
  href,
  monospace,
  truncate
}: {
  icon: React.ReactNode
  text: string | undefined
  href?: string
  monospace?: boolean
  truncate?: boolean
}) {
  if (!text) return null
  const content = (
    <span
      className={cn('flex-1', monospace && 'font-mono', truncate && 'truncate')}
    >
      {text}
    </span>
  )
  return (
    <div className="text-muted-foreground flex items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0">{icon}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground min-w-0 flex-1 transition-colors"
        >
          {content}
        </a>
      ) : (
        content
      )}
    </div>
  )
}
```

Note: the tab-array `.filter().map()` callback parameters were renamed
from `t`/single-letter to `tabDef` in this rewrite — the original file
used `t` as the callback parameter name (`(t) => t.enabled`), which would
now silently shadow the real `useTranslation()` `t` this task introduces
into the same component scope (see CLAUDE.md's i18n step 8 on this exact
shadowing hazard). This rename is required, not optional — do not revert
it to match the "before" code.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck:web && pnpm lint && pnpm format:check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/calling-tools/map-itinerary/itinerary-card.tsx src/renderer/components/calling-tools/map-itinerary/place-detail.tsx
git commit -m "feat(i18n): wire chat namespace into the map itinerary card and place detail panel"
```

---

### Task 8: Terminal card + weather card + weather forecast

**Files:**

- Modify: `src/renderer/components/calling-tools/terminal/terminal-card.tsx`
- Modify: `src/renderer/components/calling-tools/weather/weather-card.tsx`
- Modify: `src/renderer/components/calling-tools/weather/weather-forecast.tsx`

**Interfaces:**

- Consumes: `chat:terminalCard.*`, `chat:weatherCard.*`,
  `chat:weatherForecast.*` keys from Task 1.
- No exported signature changes.
- `weather-card.tsx`'s `formatTabLabel` and `weather-forecast.tsx`'s
  `formatTime`/`getWeatherIcon` are plain non-component/non-hook
  functions. `formatTabLabel`'s 2 literal returns (`'Today'`/`'Tmr'`) use
  the raw `i18n` singleton; its hardcoded `'en'` `toLocaleDateString` call
  and `formatTime`'s AM/PM literals are OUT OF SCOPE per this plan's
  Global Constraints — do not touch either.

- [ ] **Step 1: Rewrite `src/renderer/components/calling-tools/terminal/terminal-card.tsx` in full**

```typescript
import { CheckCircle2Icon, TerminalIcon, XCircleIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

interface TerminalResult {
  command: string
  cwd: string
  exitCode: number
  stdout: string
  stderr: string
}

export function TerminalCard({ toolResult }: { toolResult: TerminalResult }) {
  const { t } = useTranslation('chat')
  const success = toolResult.exitCode === 0
  const hasOutput = toolResult.stdout.length > 0
  const hasError = toolResult.stderr.length > 0

  return (
    <div className="overflow-hidden rounded-lg border font-mono text-xs">
      {/* Header */}
      <div className="bg-muted/60 flex items-center gap-2 border-b px-3 py-2">
        <TerminalIcon className="text-muted-foreground size-3.5 shrink-0" />
        <span className="text-foreground/80 flex-1 truncate">
          {toolResult.command}
        </span>
        {success ? (
          <CheckCircle2Icon className="size-3.5 shrink-0 text-green-500" />
        ) : (
          <XCircleIcon className="text-destructive size-3.5 shrink-0" />
        )}
        <span
          className={cn(
            'shrink-0',
            success ? 'text-green-500' : 'text-destructive'
          )}
        >
          {t('terminalCard.exitCode', { code: toolResult.exitCode })}
        </span>
      </div>

      {/* stdout */}
      {hasOutput && (
        <pre className="text-foreground/90 max-h-64 overflow-auto bg-transparent px-3 py-2 leading-relaxed break-all whitespace-pre-wrap">
          {toolResult.stdout}
        </pre>
      )}

      {/* stderr */}
      {hasError && (
        <pre
          className={cn(
            'max-h-40 overflow-auto px-3 py-2 leading-relaxed break-all whitespace-pre-wrap',
            hasOutput ? 'border-t' : '',
            success
              ? 'text-yellow-600 dark:text-yellow-400'
              : 'text-destructive'
          )}
        >
          {toolResult.stderr}
        </pre>
      )}

      {/* empty output */}
      {!hasOutput && !hasError && (
        <div className="text-muted-foreground px-3 py-2 italic">
          {t('terminalCard.noOutput')}
        </div>
      )}

      {/* cwd hint */}
      <div className="text-muted-foreground/60 border-t px-3 py-1.5 text-[10px]">
        {toolResult.cwd}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `src/renderer/components/calling-tools/weather/weather-card.tsx` in full**

```typescript
import { WeatherResult, WWO_CODE } from '@shared/types/weather'
import { domAnimation, LazyMotion, m } from 'framer-motion'
import { useTranslation } from 'react-i18next'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { i18n } from '@/lib/i18n'

import { WeatherForecast } from './weather-forecast'

// ── per-weather-type config ───────────────────────────────────────────────────

const THEME: Record<
  string,
  { gradient: string; emoji: string; particles?: 'rain' | 'snow' }
> = {
  Sunny: {
    gradient: 'linear-gradient(135deg, #f59e0b, #fb923c, #38bdf8)',
    emoji: '☀️'
  },
  PartlyCloudy: {
    gradient: 'linear-gradient(135deg, #7dd3fc, #60a5fa, #818cf8)',
    emoji: '⛅'
  },
  Cloudy: {
    gradient: 'linear-gradient(135deg, #94a3b8, #64748b, #475569)',
    emoji: '☁️'
  },
  VeryCloudy: {
    gradient: 'linear-gradient(135deg, #64748b, #475569, #334155)',
    emoji: '☁️'
  },
  Fog: {
    gradient: 'linear-gradient(135deg, #cbd5e1, #94a3b8, #64748b)',
    emoji: '🌫️'
  },
  LightShowers: {
    gradient: 'linear-gradient(135deg, #7dd3fc, #3b82f6, #475569)',
    emoji: '🌦️',
    particles: 'rain'
  },
  LightSleetShowers: {
    gradient: 'linear-gradient(135deg, #bae6fd, #93c5fd, #6366f1)',
    emoji: '🌨️',
    particles: 'snow'
  },
  LightSleet: {
    gradient: 'linear-gradient(135deg, #bae6fd, #93c5fd, #6366f1)',
    emoji: '🌨️',
    particles: 'snow'
  },
  LightSnow: {
    gradient: 'linear-gradient(135deg, #e0f2fe, #bae6fd, #a5b4fc)',
    emoji: '🌨️',
    particles: 'snow'
  },
  LightSnowShowers: {
    gradient: 'linear-gradient(135deg, #e0f2fe, #bae6fd, #a5b4fc)',
    emoji: '❄️',
    particles: 'snow'
  },
  HeavySnow: {
    gradient: 'linear-gradient(135deg, #f1f5f9, #bae6fd, #a5b4fc)',
    emoji: '❄️',
    particles: 'snow'
  },
  HeavySnowShowers: {
    gradient: 'linear-gradient(135deg, #f1f5f9, #bae6fd, #a5b4fc)',
    emoji: '❄️',
    particles: 'snow'
  },
  ThunderyShowers: {
    gradient: 'linear-gradient(135deg, #475569, #334155, #1e293b)',
    emoji: '⛈️',
    particles: 'rain'
  },
  ThunderyHeavyRain: {
    gradient: 'linear-gradient(135deg, #334155, #1e293b, #0f172a)',
    emoji: '⛈️',
    particles: 'rain'
  },
  ThunderySnowShowers: {
    gradient: 'linear-gradient(135deg, #475569, #334155, #312e81)',
    emoji: '🌨️',
    particles: 'snow'
  },
  LightRain: {
    gradient: 'linear-gradient(135deg, #60a5fa, #2563eb, #475569)',
    emoji: '🌧️',
    particles: 'rain'
  },
  HeavyShowers: {
    gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8, #334155)',
    emoji: '🌧️',
    particles: 'rain'
  },
  HeavyRain: {
    gradient: 'linear-gradient(135deg, #1d4ed8, #1e40af, #1e293b)',
    emoji: '⛈️',
    particles: 'rain'
  }
}

const DEFAULT_THEME = {
  gradient: 'linear-gradient(135deg, #64748b, #475569, #334155)',
  emoji: '☁️'
}

// ── particle overlays ─────────────────────────────────────────────────────────

const RAIN_DROPS = Array.from({ length: 24 }, (_, i) => ({
  left: `${(i * 4.2) % 100}%`,
  delay: (i * 0.13) % 1.2,
  duration: 0.6 + (i % 4) * 0.15
}))

const SNOW_FLAKES = Array.from({ length: 18 }, (_, i) => ({
  left: `${(i * 5.6) % 100}%`,
  delay: (i * 0.2) % 2,
  size: i % 3 === 0 ? 6 : i % 3 === 1 ? 5 : 4
}))

function RainOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* react-doctor/no-array-index-as-key: suppressed — RAIN_DROPS is a
          static module-level array of purely decorative particle specs with no
          per-item identity. The list never reorders or filters. */}
      {RAIN_DROPS.map((d, i) => (
        <m.div
          key={i}
          className="absolute rounded-full bg-white/40"
          style={{ left: d.left, top: '-8%', width: 1.5, height: 14 }}
          animate={{ y: ['0%', '120%'], opacity: [0.6, 0] }}
          transition={{
            duration: d.duration,
            repeat: Infinity,
            delay: d.delay,
            ease: 'linear'
          }}
        />
      ))}
    </div>
  )
}

function SnowOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* react-doctor/no-array-index-as-key: suppressed — SNOW_FLAKES is a
          static module-level array of purely decorative particle specs with no
          per-item identity. The list never reorders or filters. */}
      {SNOW_FLAKES.map((f, i) => (
        <m.div
          key={i}
          className="absolute rounded-full bg-white/70"
          style={{ left: f.left, top: '-5%', width: f.size, height: f.size }}
          animate={{
            y: ['0%', '110%'],
            x: [0, 12, -8, 6, 0],
            opacity: [0.8, 0]
          }}
          transition={{
            duration: 3 + (i % 3),
            repeat: Infinity,
            delay: f.delay,
            ease: 'easeInOut'
          }}
        />
      ))}
    </div>
  )
}

// ── stat pill ─────────────────────────────────────────────────────────────────

function StatPill({
  emoji,
  value,
  label
}: {
  emoji: string
  value: string
  label: string
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl bg-white/15 px-3 py-2.5 backdrop-blur-sm">
      <span className="text-base leading-none">{emoji}</span>
      <span className="text-sm leading-tight font-semibold text-white">
        {value}
      </span>
      <span className="text-[10px] leading-none text-white/60">{label}</span>
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

/**
 * A plain helper (not a component or hook) — translated text for 'Today'/
 * 'Tmr' uses the shared `i18n` singleton directly rather than
 * `useTranslation()`. The 'en'-hardcoded `toLocaleDateString` fallback
 * below is a separate, deliberately out-of-scope locale-formatting gap —
 * see this plan's Global Constraints — left untouched.
 */
function formatTabLabel(dateStr: string, i: number) {
  if (i === 0) return i18n.t('chat:weatherCard.today')
  if (i === 1) return i18n.t('chat:weatherCard.tomorrow')
  const d = new Date(dateStr)
  return d.toLocaleDateString('en', { weekday: 'short' })
}

export function WeatherCard({ toolResult }: { toolResult: WeatherResult }) {
  const { t } = useTranslation('chat')
  const { location, current, forecast } = toolResult
  const weatherType =
    WWO_CODE[current.weatherCode as keyof typeof WWO_CODE] ?? 'Cloudy'
  const theme = THEME[weatherType] ?? DEFAULT_THEME

  return (
    <LazyMotion features={domAnimation}>
      <div className="w-full max-w-xs overflow-hidden rounded-3xl shadow-2xl">
        {/* ── hero ── */}
        <div className="relative" style={{ background: theme.gradient }}>
          {theme.particles === 'rain' && <RainOverlay />}
          {theme.particles === 'snow' && <SnowOverlay />}

          <div className="relative px-5 pt-5 pb-5 text-white">
            {/* location */}
            <p className="mb-4 flex items-center gap-1 text-xs font-medium text-white/70">
              <span>📍</span>
              {location}
            </p>

            {/* temp + icon */}
            <div className="flex items-end justify-between">
              <m.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <p className="text-7xl leading-none font-thin tracking-tighter">
                  {current.tempC}°
                </p>
                <p className="mt-2 text-base font-light text-white/90">
                  {current.condition}
                </p>
                <p className="mt-0.5 text-xs text-white/55">
                  {t('weatherCard.feels', {
                    temp: current.feelsLikeC,
                    observedAt: current.observedAt
                  })}
                </p>
              </m.div>

              <m.span
                className="text-6xl leading-none select-none"
                animate={{ y: [0, -6, 0] }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: 'easeInOut'
                }}
              >
                {theme.emoji}
              </m.span>
            </div>

            {/* stats grid */}
            <div className="mt-5 grid grid-cols-3 gap-2">
              <StatPill
                emoji="💧"
                value={`${current.humidity}%`}
                label={t('weatherCard.humidity')}
              />
              <StatPill
                emoji="💨"
                value={`${current.windKmph} km/h`}
                label={`${current.windDir}`}
              />
              <StatPill
                emoji="☔"
                value={`${current.precipMM}mm`}
                label={t('weatherCard.precip')}
              />
              <StatPill
                emoji="👁"
                value={`${current.visibility} km`}
                label={t('weatherCard.visibility')}
              />
              <StatPill
                emoji="🔆"
                value={current.uvIndex}
                label={t('weatherCard.uvIndex')}
              />
              <StatPill emoji="📊" value={`${current.pressure}`} label="hPa" />
            </div>
          </div>
        </div>

        {/* ── forecast tabs ── */}
        <Tabs defaultValue="0">
          <TabsList className="mx-3 my-1 grid grid-cols-3 bg-transparent">
            {forecast.slice(0, 3).map((day, i) => {
              const dayType =
                WWO_CODE[day.weatherCode as keyof typeof WWO_CODE] ?? 'Cloudy'
              const dayEmoji = (THEME[dayType] ?? DEFAULT_THEME).emoji
              return (
                <TabsTrigger
                  key={day.date}
                  value={String(i)}
                  className="flex flex-col gap-1 py-1 text-xs"
                >
                  <span className="text-base leading-none">{dayEmoji}</span>
                  <span className="font-medium">
                    {formatTabLabel(day.date, i)}
                  </span>
                </TabsTrigger>
              )
            })}
          </TabsList>

          {forecast.slice(0, 3).map((day, i) => (
            <TabsContent key={day.date} value={String(i)} className="p-0">
              <WeatherForecast forecast={day} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </LazyMotion>
  )
}
```

- [ ] **Step 3: Rewrite `src/renderer/components/calling-tools/weather/weather-forecast.tsx` in full**

```typescript
import { WeatherForecastDay, WWO_CODE } from '@shared/types/weather'
import { domAnimation, LazyMotion, m } from 'framer-motion'
import {
  CloudDrizzleIcon,
  CloudFogIcon,
  CloudIcon,
  CloudLightningIcon,
  CloudRainIcon,
  CloudSnowIcon,
  CloudSunIcon,
  SunIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

function getWeatherIcon(code: string) {
  const type = WWO_CODE[code as keyof typeof WWO_CODE] ?? 'Cloudy'
  switch (type) {
    case 'Sunny':
      return <SunIcon className="size-4 text-yellow-400" />
    case 'PartlyCloudy':
      return <CloudSunIcon className="size-4 text-blue-400" />
    case 'Cloudy':
      return <CloudIcon className="size-4 text-slate-400" />
    case 'VeryCloudy':
      return <CloudIcon className="size-4 text-slate-600" />
    case 'Fog':
      return <CloudFogIcon className="size-4 text-slate-300" />
    case 'LightShowers':
      return <CloudDrizzleIcon className="size-4 text-blue-300" />
    case 'LightSleetShowers':
    case 'LightSleet':
      return <CloudSnowIcon className="size-4 text-blue-200" />
    case 'LightSnow':
    case 'LightSnowShowers':
      return <CloudSnowIcon className="size-4 text-slate-200" />
    case 'HeavySnow':
    case 'HeavySnowShowers':
      return <CloudSnowIcon className="size-4 text-white" />
    case 'ThunderyShowers':
    case 'ThunderyHeavyRain':
    case 'ThunderySnowShowers':
      return <CloudLightningIcon className="size-4 text-yellow-500" />
    case 'LightRain':
      return <CloudRainIcon className="size-4 text-blue-400" />
    case 'HeavyShowers':
    case 'HeavyRain':
      return <CloudRainIcon className="size-4 text-blue-600" />
    default:
      return <CloudIcon className="size-4 text-slate-400" />
  }
}

// "0" → "12 AM", "900" → "9 AM", "1500" → "3 PM"
// Deliberately out of scope for this i18n pass — see this plan's Global
// Constraints: this hardcodes 12-hour AM/PM notation regardless of locale,
// which is a date/time-formatting concern (useFormat()/Intl.DateTimeFormat
// territory), not a string-extraction site.
function formatTime(time: string): string {
  const h = Math.floor(Number(time) / 100)
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}

export function WeatherForecast({
  forecast
}: {
  forecast: WeatherForecastDay
}) {
  const { t } = useTranslation('chat')
  return (
    <LazyMotion features={domAnimation}>
      <div className="flex flex-col gap-3 px-2 pt-3 pb-2">
        {/* ── min/max bar ── */}
        <div className="bg-muted/60 rounded-2xl px-3 py-2.5">
          <div className="text-muted-foreground mb-1.5 flex items-center justify-between text-xs">
            <span>{t('weatherForecast.temperatureRange')}</span>
            <span className="text-foreground font-semibold">
              {forecast.minTempC}° – {forecast.maxTempC}°
            </span>
          </div>
          <div className="bg-muted relative h-2 w-full overflow-hidden rounded-full">
            <m.div
              className="absolute inset-y-0 rounded-full"
              style={{
                background: 'linear-gradient(90deg, #38bdf8, #fb923c)',
                left: '0%',
                right: '0%'
              }}
              initial={{ scaleX: 0, originX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </div>
          <div className="text-muted-foreground mt-2 flex justify-between text-[10px]">
            <span>{t('weatherForecast.cold')}</span>
            <span>{t('weatherForecast.hot')}</span>
          </div>
        </div>

        {/* ── sunrise / sunset ── */}
        <div className="flex gap-2">
          <div className="bg-muted/60 flex flex-1 items-center gap-2 rounded-2xl px-3 py-2">
            <span className="text-lg leading-none">🌅</span>
            <div>
              <p className="text-muted-foreground text-[10px]">
                {t('weatherForecast.sunrise')}
              </p>
              <p className="text-xs font-semibold">{forecast.sunrise}</p>
            </div>
          </div>
          <div className="bg-muted/60 flex flex-1 items-center gap-2 rounded-2xl px-3 py-2">
            <span className="text-lg leading-none">🌇</span>
            <div>
              <p className="text-muted-foreground text-[10px]">
                {t('weatherForecast.sunset')}
              </p>
              <p className="text-xs font-semibold">{forecast.sunset}</p>
            </div>
          </div>
        </div>

        {/* ── hourly scroll ── */}
        <div className="relative">
          <div className="no-scrollbar flex gap-2 overflow-x-scroll pb-1">
            {forecast.hourly.map((h, index) => {
              const rainPct = Number(h.rainChance)
              return (
                <m.div
                  key={h.time}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04, duration: 0.3 }}
                  className="bg-muted/60 flex min-w-[52px] shrink-0 flex-col items-center gap-1 rounded-2xl px-2.5 py-2"
                >
                  <span className="text-muted-foreground text-[10px] leading-none">
                    {formatTime(h.time)}
                  </span>
                  <div className="my-0.5">{getWeatherIcon(h.weatherCode)}</div>
                  <span className="text-xs leading-none font-semibold">
                    {h.tempC}°
                  </span>
                  {rainPct > 0 ? (
                    <span className="text-[9px] leading-none font-medium text-blue-400">
                      💧{rainPct}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50 text-[9px] leading-none">
                      —
                    </span>
                  )}
                </m.div>
              )
            })}
          </div>
          <div className="from-card pointer-events-none absolute top-0 right-0 h-full w-10 bg-linear-to-l to-transparent" />
        </div>
      </div>
    </LazyMotion>
  )
}
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck:web && pnpm lint && pnpm format:check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/calling-tools/terminal/terminal-card.tsx src/renderer/components/calling-tools/weather/weather-card.tsx src/renderer/components/calling-tools/weather/weather-forecast.tsx
git commit -m "feat(i18n): wire chat namespace into the terminal card and weather cards"
```

---

### Task 9: Whole-plan verification

**Files:** none (verification only).

- [ ] **Step 1: Confirm no bare hardcoded literals remain in the touched files**

Run:

```bash
grep -n "'Cannot open artifact file'\|'Reveal in file manager'" src/renderer/components/calling-tools/artifact/artifact-card.tsx
grep -n "'Computer Use'\|'Could not stop the session'" src/renderer/components/calling-tools/computer-use/computer-use-card.tsx
grep -n "'Deep Researching\|'Export failed'" src/renderer/components/calling-tools/deep-research/deep-research-card.tsx
grep -n "no diagram source\|'Open in draw.io'" src/renderer/components/calling-tools/drawio/drawio-card.tsx
grep -n ": 'Tool'" src/renderer/components/calling-tools/generic-tool-card.tsx src/renderer/components/messages-calling-tools.tsx
grep -n "Add a Google API Key" src/renderer/components/calling-tools/map-itinerary/itinerary-card.tsx
grep -n "'Anonymous'\|'Overview'," src/renderer/components/calling-tools/map-itinerary/place-detail.tsx
grep -n "'No output'" src/renderer/components/calling-tools/terminal/terminal-card.tsx
grep -n "label=\"Humidity\"\|label=\"Precip\"" src/renderer/components/calling-tools/weather/weather-card.tsx
grep -n "Temperature range\|>Sunrise<\|>Sunset<" src/renderer/components/calling-tools/weather/weather-forecast.tsx
```

Expected: no matches on any of these (every one was rewired in Tasks 2-8).
A match means a task's rewrite didn't fully land — fix it in that file,
not here.

- [ ] **Step 2: Confirm the deliberately-untouched files are still untouched**

Run:

```bash
git diff --stat 6391f144 -- src/renderer/components/calling-tools/map-itinerary/day-layer.tsx src/renderer/components/calling-tools/map-itinerary/types.ts src/renderer/components/calling-tools/stock-charts/symbol-overview-chart.tsx
```

(`6391f144` is the `chat-core` plan's first commit — before this plan or
that one touched anything under `calling-tools/`.)
Expected: empty output — these 3 files have zero diff from before either
`chat` sub-plan started, confirming they were correctly left alone.

- [ ] **Step 3: Run the full pre-commit gate**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm i18n:check && pnpm test`
Expected: all green except the one standing, already-committed, documented
orphan-id exception (`TEST_IDS.providerModels.modelSelect`) — re-verify
this is really the only failure, don't assume it.

- [ ] **Step 4: Run `pnpm i18n:audit`**

Run: `pnpm i18n:audit`
Expected: the renderer-string count should have dropped meaningfully
(~50-60 sites targeted across these 8 files). As with the `chat-core`
plan, this working tree may have unrelated concurrent edits happening in
parallel — if the count doesn't move as cleanly expected, say so
explicitly rather than asserting "as expected" without checking; Step 1's
direct per-file grep is the reliable confirmation regardless.

- [ ] **Step 5: Confirm `image-generation/`'s own i18n is untouched**

Run: `git diff --stat 6391f144 -- src/renderer/components/calling-tools/image-generation/`
Expected: empty — this plan never touches this directory (it was fully
i18n'd by separate, earlier work).
