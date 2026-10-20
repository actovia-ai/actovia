# Artifacts (Rich Visual Rendering) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the AI to generate interactive React components (charts, tables, dashboards, etc.) from research data and render them live in the chat, instead of summarizing everything as plain text.

**Architecture:** A new `createArtifact` tool lets the LLM emit JSX code. The chat UI renders it inside a sandboxed iframe that points to a pre-built "artifact sandbox" sub-app. The sandbox uses `sucrase` for real-time JSX→JS transpilation and shares the same Tailwind CSS + shadcn/ui design tokens as the main app. Artifacts are persisted to `~/.actovia/artifacts/{chatId}/` for later viewing.

**Tech Stack:** sucrase (fast JSX transpile), iframe sandbox, postMessage API, Tailwind CSS, recharts, lucide-react

**Security note:** The sandbox uses `new Function()` to evaluate LLM-generated code inside an iframe with `sandbox="allow-scripts allow-same-origin"`. This is intentional — the artifact feature's purpose is to render dynamic code from the AI. The iframe sandbox provides DOM isolation from the main app.

---

### Task 1: Create the artifact sandbox sub-app

**Files:**

- Create: `src/renderer/sub-apps/artifacts/index.html`
- Create: `src/renderer/sub-apps/artifacts/main.tsx`
- Create: `src/renderer/sub-apps/artifacts/sandbox.tsx`
- Modify: `electron.vite.config.ts` — add artifacts entry point

- [ ] **Step 1: Create `index.html`**

```html
<!-- src/renderer/sub-apps/artifacts/index.html -->
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Actovia Artifact</title>
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src * data: blob:; connect-src 'self' http://localhost:*; font-src 'self' data:;"
    />
    <script src="../../tone-init.js"></script>
  </head>
  <body>
    <div id="artifact-root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

Note: `'unsafe-eval'` is required for the `new Function()` call used to evaluate transpiled artifact code. This is scoped to the artifact iframe only and does not affect the main app's CSP.

- [ ] **Step 2: Create `main.tsx`**

```tsx
// src/renderer/sub-apps/artifacts/main.tsx
import '@/assets/stylesheets/globals.css'
import React from 'react'
import ReactDOM from 'react-dom/client'

import { ThemeProvider } from '@/components/theme-provider'

import { ArtifactSandbox } from './sandbox'

ReactDOM.createRoot(
  document.getElementById('artifact-root') as HTMLElement
).render(
  <React.StrictMode>
    <ThemeProvider>
      <ArtifactSandbox />
    </ThemeProvider>
  </React.StrictMode>
)
```

- [ ] **Step 3: Create `sandbox.tsx`** — the core runtime

This component listens for `postMessage` from the parent chat window, transpiles JSX code using sucrase, and renders the resulting component.

```tsx
// src/renderer/sub-apps/artifacts/sandbox.tsx
import * as LucideIcons from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'
import * as Recharts from 'recharts'
import { transform } from 'sucrase'

// Pre-import shadcn/ui components that artifacts can use
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// Registry of modules available to artifact code via require()
const MODULE_REGISTRY: Record<string, unknown> = {
  react: React,
  recharts: Recharts,
  'lucide-react': LucideIcons,
  '@/ui/button': { Button },
  '@/ui/card': { Card, CardContent, CardHeader, CardTitle },
  '@/ui/badge': { Badge },
  '@/ui/table': {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
  },
  '@/ui/tabs': { Tabs, TabsContent, TabsList, TabsTrigger }
}

function artifactRequire(mod: string): unknown {
  const resolved = MODULE_REGISTRY[mod]
  if (!resolved) {
    console.warn(`[Artifact] Unknown module: ${mod}`)
    return {}
  }
  return resolved
}

function transpileAndEval(code: string): React.ComponentType<unknown> | null {
  // Step 1: Transpile TSX/JSX to plain JS
  const jsCode = transform(code, {
    transforms: ['typescript', 'jsx'],
    jsxRuntime: 'classic',
    production: true
  }).code

  // Step 2: Evaluate in a controlled scope with require/React/exports
  // This is intentional: the artifact feature's purpose is to render
  // LLM-generated React components inside an isolated iframe sandbox.
  const exports: Record<string, unknown> = {}
  const moduleObj = { exports }
  const evalFn = new Function('require', 'React', 'exports', 'module', jsCode)
  evalFn(artifactRequire, React, exports, moduleObj)

  // Step 3: Extract the default export (the component)
  const Component =
    (moduleObj.exports as { default?: unknown }).default ??
    (exports.default as unknown) ??
    Object.values(exports).find((v) => typeof v === 'function')

  return Component as React.ComponentType<unknown> | null
}

interface ArtifactMessage {
  type: 'render'
  code: string
  artifactId: string
}

export function ArtifactSandbox() {
  const [Component, setComponent] =
    useState<React.ComponentType<unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleMessage = useCallback((event: MessageEvent) => {
    const data = event.data as ArtifactMessage
    if (data?.type !== 'render') return

    setError(null)
    try {
      const Comp = transpileAndEval(data.code)
      if (Comp) {
        setComponent(() => Comp)
      } else {
        setError('Failed to render artifact — no component exported')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transpilation failed')
    }
  }, [])

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  if (error) {
    return (
      <div className="text-destructive flex h-full items-center justify-center p-4 text-sm">
        {error}
      </div>
    )
  }

  if (!Component) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-4 text-sm">
        Waiting for artifact...
      </div>
    )
  }

  return (
    <ErrorBoundary onError={(err) => setError(err.message)}>
      <div className="p-4">
        <Component />
      </div>
    </ErrorBoundary>
  )
}

// Minimal error boundary for catching render errors in artifact components
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: (err: Error) => void },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    this.props.onError(error)
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}
```

- [ ] **Step 4: Add artifacts entry to vite config**

In `electron.vite.config.ts`, add the artifacts entry alongside the existing ones in `rollupOptions.input`:

```ts
artifacts: path.resolve(
  __dirname,
  'src',
  'renderer',
  'sub-apps',
  'artifacts',
  'index.html'
)
```

- [ ] **Step 5: Install sucrase**

Run: `pnpm add sucrase`

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck:web`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/sub-apps/artifacts/ electron.vite.config.ts package.json pnpm-lock.yaml
git commit -m "feat: add artifact sandbox sub-app with JSX transpilation runtime"
```

---

### Task 2: Create the `createArtifact` tool

**Files:**

- Create: `src/main/lib/ai/calling-tools/create-artifact.ts`
- Modify: `src/main/lib/ai/calling-tools/index.ts` — export new tool
- Modify: `src/main/lib/ai/utils/tool-binding-util.ts` — bind tool

- [ ] **Step 1: Create tool definition**

```ts
// src/main/lib/ai/calling-tools/create-artifact.ts
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'

const createArtifactSchema = Type.Object({
  title: Type.String({
    description: 'Short title for the artifact (shown in the card header)'
  }),
  code: Type.String({
    description: `A self-contained React component in TSX.
Available imports (use CommonJS require):
- react (React, useState, useEffect, useMemo, useCallback, etc.)
- recharts (LineChart, BarChart, PieChart, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend, CartesianGrid, Line, Bar, Pie, Cell, Area, AreaChart, etc.)
- lucide-react (any icon, e.g. TrendingUp, Users, Globe, etc.)
- @/ui/button (Button)
- @/ui/card (Card, CardContent, CardHeader, CardTitle)
- @/ui/badge (Badge)
- @/ui/table (Table, TableBody, TableCell, TableHead, TableHeader, TableRow)
- @/ui/tabs (Tabs, TabsContent, TabsList, TabsTrigger)

Use Tailwind CSS for all styling. Use CSS variables for chart colors: var(--chart-1) through var(--chart-5).
Export default a React component via module.exports.

Example:
const React = require('react')
const { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } = require('recharts')
const { Card, CardHeader, CardTitle, CardContent } = require('@/ui/card')

const data = [{ name: 'A', value: 40 }, { name: 'B', value: 70 }]

function Chart() {
  return (
    <Card>
      <CardHeader><CardTitle>My Chart</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value" fill="var(--chart-1)" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

module.exports = { default: Chart }`
  })
})

export const createArtifact: AgentTool<typeof createArtifactSchema> = {
  name: 'createArtifact',
  label: 'Create Artifact',
  description:
    'Create a rich visual artifact (chart, table, dashboard, comparison, etc.) rendered as a live React component. Use this when data would be better presented visually rather than as plain text — for example after collecting research data, comparing options, or analyzing statistics. The component will be rendered in an interactive sandbox with Tailwind CSS styling.',
  parameters: createArtifactSchema,
  execute: async (_toolCallId, { title, code }) => {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Created artifact: ${title}`
        }
      ],
      details: {
        type: 'artifact',
        title,
        code
      }
    }
  }
}
```

- [ ] **Step 2: Export from index**

In `src/main/lib/ai/calling-tools/index.ts`, add:

```ts
export { createArtifact } from './create-artifact'
```

- [ ] **Step 3: Bind tool in tool-binding-util.ts**

In `src/main/lib/ai/utils/tool-binding-util.ts`, add the import of `createArtifact` from `../calling-tools`, then in the `bindCallingTools` function, add after the webFetch line:

```ts
if (enabled('createArtifact')) tools.push(createArtifact)
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck:node`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/lib/ai/calling-tools/create-artifact.ts \
  src/main/lib/ai/calling-tools/index.ts \
  src/main/lib/ai/utils/tool-binding-util.ts
git commit -m "feat: add createArtifact tool for visual content generation"
```

---

### Task 3: Create the artifact card component (chat UI)

**Files:**

- Create: `src/renderer/components/calling-tools/artifact/artifact-card.tsx`
- Modify: `src/renderer/components/messages-calling-tools.tsx` — render artifact card

- [ ] **Step 1: Create artifact card**

This component renders an iframe that loads the artifact sandbox sub-app and sends the code via postMessage.

```tsx
// src/renderer/components/calling-tools/artifact/artifact-card.tsx
import { is } from '@electron-toolkit/utils'
import { CodeIcon, MaximizeIcon, MinimizeIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ArtifactDetails {
  type: 'artifact'
  title: string
  code: string
}

function getArtifactSandboxUrl(): string {
  if (is.dev && import.meta.env.ELECTRON_RENDERER_URL) {
    return `${import.meta.env.ELECTRON_RENDERER_URL}/sub-apps/artifacts/index.html`
  }
  return '../sub-apps/artifacts/index.html'
}

export function ArtifactCard({ toolResult }: { toolResult: ArtifactDetails }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [showCode, setShowCode] = useState(false)
  const [iframeReady, setIframeReady] = useState(false)

  const sendCode = useCallback(() => {
    if (iframeRef.current?.contentWindow && toolResult.code) {
      iframeRef.current.contentWindow.postMessage(
        { type: 'render', code: toolResult.code, artifactId: toolResult.title },
        '*'
      )
    }
  }, [toolResult.code, toolResult.title])

  useEffect(() => {
    if (iframeReady) sendCode()
  }, [iframeReady, sendCode])

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          {toolResult.title}
        </CardTitle>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowCode(!showCode)}
            title={showCode ? 'Hide code' : 'Show code'}
          >
            <CodeIcon size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {showCode && (
          <pre className="bg-muted/50 max-h-60 overflow-auto border-b p-3 text-xs">
            <code>{toolResult.code}</code>
          </pre>
        )}
        <iframe
          ref={iframeRef}
          src={getArtifactSandboxUrl()}
          onLoad={() => setIframeReady(true)}
          className="w-full border-0"
          style={{ height: expanded ? '600px' : '400px' }}
          sandbox="allow-scripts allow-same-origin"
          title={toolResult.title}
        />
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Register artifact card in messages-calling-tools.tsx**

In `src/renderer/components/messages-calling-tools.tsx`, add the import:

```ts
import { ArtifactCard } from './calling-tools/artifact/artifact-card'
```

Then inside the return JSX, after the `deepResearch` line and before the combined check for `imageGeneration`/`readFile`/etc., add:

```tsx
{
  toolName === 'createArtifact' && output?.type === 'artifact' && (
    <ArtifactCard toolResult={output} />
  )
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck:web`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/calling-tools/artifact/ \
  src/renderer/components/messages-calling-tools.tsx
git commit -m "feat: add artifact card component with iframe sandbox rendering"
```

---

### Task 4: Artifact persistence

**Files:**

- Create: `src/main/lib/ai/artifacts.ts`
- Create: `src/main/lib/server/routes/artifacts.ts`
- Modify: `src/main/lib/server/app.ts` — register route
- Modify: `src/main/lib/paths.ts` — add `getArtifactsDir()`
- Modify: `src/main/lib/ai/calling-tools/create-artifact.ts` — persist on execute

- [ ] **Step 1: Add `getArtifactsDir` to paths.ts**

In `src/main/lib/paths.ts`, add a new function:

```ts
export function getArtifactsDir(): string {
  return join(getActoviaHome(), 'artifacts')
}
```

Also add `getArtifactsDir()` to the dirs array inside `ensureActoviaDirs()`.

- [ ] **Step 2: Create artifacts persistence module**

```ts
// src/main/lib/ai/artifacts.ts
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'

import { getArtifactsDir } from '../paths'

export interface ArtifactMeta {
  id: string
  chatId: string
  title: string
  createdAt: string
}

function getChatArtifactsDir(chatId: string): string {
  const dir = join(getArtifactsDir(), chatId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export async function saveArtifact(
  chatId: string,
  artifactId: string,
  title: string,
  code: string
): Promise<string> {
  const dir = getChatArtifactsDir(chatId)
  const filePath = join(dir, `${artifactId}.tsx`)
  const metaPath = join(dir, `${artifactId}.json`)

  await writeFile(filePath, code, 'utf-8')
  await writeFile(
    metaPath,
    JSON.stringify(
      { id: artifactId, chatId, title, createdAt: new Date().toISOString() },
      null,
      2
    ),
    'utf-8'
  )

  return filePath
}

export function getArtifact(
  chatId: string,
  artifactId: string
): { code: string; meta: ArtifactMeta } | null {
  const dir = join(getArtifactsDir(), chatId)
  const filePath = join(dir, `${artifactId}.tsx`)
  const metaPath = join(dir, `${artifactId}.json`)

  if (!existsSync(filePath)) return null

  const code = readFileSync(filePath, 'utf-8')
  const meta = existsSync(metaPath)
    ? (JSON.parse(readFileSync(metaPath, 'utf-8')) as ArtifactMeta)
    : { id: artifactId, chatId, title: artifactId, createdAt: '' }

  return { code, meta }
}

export function listArtifacts(chatId: string): ArtifactMeta[] {
  const dir = join(getArtifactsDir(), chatId)
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as ArtifactMeta)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
```

- [ ] **Step 3: Create artifacts API route**

```ts
// src/main/lib/server/routes/artifacts.ts
import { Variables } from '@shared/types/server'
import { Hono } from 'hono'

import { getArtifact, listArtifacts } from '../../ai/artifacts'
import { successResponse } from '../utils'

const artifactsRouter = new Hono<{ Variables: Variables }>()

artifactsRouter.get('/:chatId', async (c) => {
  const chatId = c.req.param('chatId')
  return successResponse(c, listArtifacts(chatId))
})

artifactsRouter.get('/:chatId/:artifactId', async (c) => {
  const chatId = c.req.param('chatId')
  const artifactId = c.req.param('artifactId')
  const result = getArtifact(chatId, artifactId)
  if (!result) return c.json({ error: 'Artifact not found' }, 404)
  return successResponse(c, result)
})

export default artifactsRouter
```

- [ ] **Step 4: Register route in app.ts**

In `src/main/lib/server/app.ts`, add:

```ts
import artifactsRouter from './routes/artifacts'
// In routes section:
app.route('/api/artifacts', artifactsRouter)
```

- [ ] **Step 5: Update createArtifact tool to persist**

In `src/main/lib/ai/calling-tools/create-artifact.ts`, update the execute to save artifacts. Add imports:

```ts
import { v4 as uuidV4 } from 'uuid'

import { saveArtifact } from '../artifacts'
```

Update execute:

```ts
execute: async (_toolCallId, { title, code }) => {
  const artifactId = uuidV4()

  // Persist artifact to disk (fire-and-forget)
  saveArtifact('shared', artifactId, title, code).catch(() => {})

  return {
    content: [{ type: 'text' as const, text: `Created artifact: ${title}` }],
    details: {
      type: 'artifact',
      artifactId,
      title,
      code
    }
  }
}
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/lib/ai/artifacts.ts \
  src/main/lib/server/routes/artifacts.ts \
  src/main/lib/server/app.ts \
  src/main/lib/paths.ts \
  src/main/lib/ai/calling-tools/create-artifact.ts
git commit -m "feat: add artifact persistence and API routes"
```

---

### Task 5: Integration testing and verification

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: No new failures

- [ ] **Step 3: Run lint and format**

Run: `pnpm lint && pnpm format:check`
Expected: No errors

- [ ] **Step 4: Test manually**

Run: `pnpm dev`

Verify:

1. App starts without errors
2. Send a message like: "Show me a bar chart comparing the population of the top 5 countries"
3. The AI should use the `createArtifact` tool
4. An artifact card should appear in the chat with:
   - Title header
   - Code toggle button
   - Expand/collapse button
   - Rendered chart inside iframe
5. The chart should use the app's color scheme (Tailwind CSS variables)
6. `~/.actovia/artifacts/` should contain saved artifact files

- [ ] **Step 5: Final commit if any fixes needed**
