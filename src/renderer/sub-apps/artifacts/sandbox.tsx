import { HugeiconsIcon } from '@hugeicons/react'
import * as Motion from 'framer-motion'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as ReactJsxDevRuntime from 'react/jsx-dev-runtime'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as Recharts from 'recharts'
import { transform } from 'sucrase'

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

import { artifactIcons } from './sandbox-icons'
import { observeSize } from './size-report'

const MODULE_REGISTRY: Record<string, unknown> = {
  react: React,
  // Required by the automatic JSX runtime: sucrase compiles JSX to
  // `require("react/jsx-runtime").jsx(...)` (or the dev runtime in dev mode).
  'react/jsx-runtime': ReactJsxRuntime,
  'react/jsx-dev-runtime': ReactJsxDevRuntime,
  recharts: Recharts,
  // The icons an artifact may draw: a curated set of Hugeicons (the whole
  // free package is 14k icons) behind a Proxy that hands an unknown name a
  // placeholder, so a misremembered name never breaks the artifact.
  '@hugeicons/react': { HugeiconsIcon },
  '@hugeicons/core-free-icons': artifactIcons,
  'framer-motion': Motion,
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

/**
 * Tells the embedder how the last render went: `artifact-sandbox-rendered`, or
 * `artifact-sandbox-error` with the message the page shows. The desktop's card
 * ignores both; actovia-ios, which loads this page as its own top-level window
 * (so `window.parent` is the page itself), waits for one of them before it
 * shows the artifact, and says to view it on the computer when it is an error.
 */
function reportOutcome(
  outcome: { type: 'rendered' } | { type: 'error'; message: string }
) {
  window.parent?.postMessage(
    outcome.type === 'rendered'
      ? { type: 'artifact-sandbox-rendered' }
      : { type: 'artifact-sandbox-error', message: outcome.message },
    '*'
  )
}

function artifactRequire(moduleId: string): unknown {
  const resolved = MODULE_REGISTRY[moduleId]
  if (resolved !== undefined) {
    return resolved
  }
  console.warn(`[artifact-sandbox] Unknown module requested: "${moduleId}"`)
  return {}
}

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback: (error: Error) => React.ReactNode
  onError?: (error: Error) => void
}

interface ErrorBoundaryState {
  error: Error | null
}

class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[artifact-sandbox] Render error:', error, info)
    this.props.onError?.(error)
  }

  override render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error)
    }
    return this.props.children
  }
}

interface ArtifactMessage {
  type: 'render'
  code: string
  artifactId: string
}

function isArtifactMessage(data: unknown): data is ArtifactMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as ArtifactMessage).type === 'render' &&
    typeof (data as ArtifactMessage).code === 'string' &&
    typeof (data as ArtifactMessage).artifactId === 'string'
  )
}

// NOTE: new Function() is used intentionally here. The artifact sandbox's
// purpose is to render LLM-generated React components inside an isolated
// iframe. This is a known, documented security trade-off for the feature.

export function ArtifactSandbox() {
  const [Component, setComponent] = useState<React.ComponentType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState(0)
  // Set by the boundary during the commit that caught, so the effect that
  // follows it does not also report the render as a success.
  const renderFailed = useRef(false)
  const size = useRef<ReturnType<typeof observeSize> | null>(null)

  const handleMessage = useCallback((event: MessageEvent) => {
    // Only the embedding window may hand this frame code to run — not a frame
    // an artifact opened itself, nor anything else that can reach this window.
    if (event.source !== window.parent) return
    const { data } = event

    // Handle theme sync from parent
    if (data?.type === 'theme' && typeof data.theme === 'string') {
      const root = document.documentElement
      root.classList.remove('light', 'dark')
      if (data.theme === 'system') {
        const sys = window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        root.classList.add(sys)
      } else {
        root.classList.add(data.theme)
      }
      return
    }

    // A phone shows the artifact as a page of its own, not a card in a chat:
    // its outermost card loses its frame (index.html). The desktop never
    // sends this, so its card is unchanged.
    if (data?.type === 'layout' && typeof data.layout === 'string') {
      document.documentElement.dataset.layout =
        data.layout === 'page' ? 'page' : 'card'
      return
    }

    if (!isArtifactMessage(data)) return

    try {
      // Use the automatic JSX runtime (`react/jsx-runtime`) instead of the
      // classic transform. The classic transform emits
      // `React.createElement(..., { __self, __source })`, which trips React 19's
      // "outdated JSX transform" dev warning on every artifact render. The
      // `imports` transform is required so sucrase emits the runtime as a CJS
      // `require("react/jsx-runtime")` (resolved via MODULE_REGISTRY) rather
      // than an ESM `import`, which the wrapper below cannot evaluate.
      const { code: transformed } = transform(data.code, {
        transforms: ['typescript', 'jsx', 'imports'],
        jsxRuntime: 'automatic',
        production: import.meta.env.PROD
      })

      const moduleExports: Record<string, unknown> = {}
      const moduleObj = { exports: moduleExports }

      // Wrap in IIFE so the LLM's `const React = require('react')` etc.
      // live in their own scope and don't clash with our outer bindings.
      const wrapped =
        '(function(require, exports, module) {\n' +
        transformed +
        '\n})(require, exports, module);'

      // Intentional: this is the artifact sandbox execution engine. AI-generated
      // artifact code must be dynamically evaluated so users can run components
      // the LLM produces. Isolation is enforced at the iframe level: this page
      // is served from its own origin (`actovia-artifact://sandbox`, see
      // src/main/lib/artifact-protocol.ts), so `window.parent` is cross-origin,
      // and its CSP allows no network access at all. Keep it that way — nothing
      // added here may need the API.
      // eslint-disable-next-line no-new-func
      // react-doctor-disable-next-line react-doctor/no-eval -- Deliberate sandbox execution engine; isolated in sandboxed artifacts iframe with CSP
      const factory = new Function('require', 'exports', 'module', wrapped)
      factory(artifactRequire, moduleExports, moduleObj)

      const exported =
        (moduleObj.exports as Record<string, unknown>).default ||
        moduleObj.exports

      if (typeof exported !== 'function') {
        const message = 'Artifact code did not export a valid React component.'
        setError(message)
        setComponent(null)
        reportOutcome({ type: 'error', message })
        return
      }

      renderFailed.current = false
      setError(null)
      setComponent(() => exported as React.ComponentType)
      setKey((k) => k + 1)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown transpile/eval error'
      console.error('[artifact-sandbox] Transpile/eval error:', err)
      setError(message)
      setComponent(null)
      reportOutcome({ type: 'error', message })
    }
  }, [])

  // After each new component has committed: rendered, unless the boundary
  // caught it on the way in (it has reported the error itself).
  useEffect(() => {
    if (key === 0 || renderFailed.current) return
    reportOutcome({ type: 'rendered' })
    size.current?.report()
  }, [key])

  const handleRenderError = useCallback((err: Error) => {
    renderFailed.current = true
    reportOutcome({ type: 'error', message: err.message })
  }, [])

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    // Handshake: tell the parent we're ready to receive render messages.
    // Without this, the parent's `onLoad` can fire before this listener is
    // attached, dropping the initial render message and stranding the UI on
    // "Waiting for artifact...". Worst seen on fullscreen, where a fresh
    // iframe mounts every time.
    window.parent?.postMessage({ type: 'artifact-sandbox-ready' }, '*')
    // The artifact's height, as it changes (see size-report.ts).
    const root = document.querySelector('#artifact-root')
    size.current = root
      ? observeSize(root, (message) => window.parent?.postMessage(message, '*'))
      : null
    return () => {
      window.removeEventListener('message', handleMessage)
      size.current?.disconnect()
      size.current = null
    }
  }, [handleMessage])

  if (error) {
    return (
      <div className="p-4">
        <p className="text-destructive text-sm">{error}</p>
      </div>
    )
  }

  if (!Component) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground text-sm">Waiting for artifact...</p>
      </div>
    )
  }

  return (
    <ErrorBoundary
      key={key}
      onError={handleRenderError}
      fallback={(err) => (
        <div className="p-4">
          <p className="text-destructive text-sm">{err.message}</p>
        </div>
      )}
    >
      <Component />
    </ErrorBoundary>
  )
}
