import { IS_WEB_CLIENT } from '@actovia/shared/constants/systems'

// The sandbox is another HTML entry of this same renderer build (see
// vite.renderer.config.mts). Vite's root is the repo root, so its page keeps
// the `src/renderer/sub-apps/` prefix — in the dev server and in the built
// renderer directory alike, which is what the scheme below serves.
const ARTIFACT_SANDBOX_PAGE = 'src/renderer/sub-apps/artifacts/index.html'

// The sandbox runs model-written code, so it gets an origin of its own — served
// by the main process through a custom scheme (src/main/lib/artifact-protocol.ts)
// rather than from this window's origin, where `window.parent` would hand that
// code the IPC bridge and the API. Same URL in dev and packaged. A literal, as
// the renderer cannot import main-process code.
export const ARTIFACT_ORIGIN = 'actovia-artifact://sandbox'

export function getArtifactSandboxUrl(): string {
  return IS_WEB_CLIENT
    ? `/api/v1/artifacts/sandbox/${ARTIFACT_SANDBOX_PAGE}`
    : `${ARTIFACT_ORIGIN}/${ARTIFACT_SANDBOX_PAGE}`
}

export function isSandboxMessageFrom(
  event: MessageEvent,
  iframe: HTMLIFrameElement | null
): boolean {
  if (!iframe || event.source !== iframe.contentWindow) return false
  return IS_WEB_CLIENT
    ? event.origin === 'null'
    : event.origin === ARTIFACT_ORIGIN
}

export function sendToIframe(
  iframe: HTMLIFrameElement | null,
  code: string,
  title: string
) {
  const win = iframe?.contentWindow
  if (!win || !code) return
  const theme = window.localStorage.getItem('vite-ui-theme') ?? 'system'
  // Web previews use an opaque origin (sandbox without allow-same-origin),
  // so targetOrigin must be '*'. The receiver checks event.source === parent.
  const targetOrigin = IS_WEB_CLIENT ? '*' : ARTIFACT_ORIGIN
  win.postMessage({ type: 'theme', theme }, targetOrigin)
  win.postMessage({ type: 'render', code, artifactId: title }, targetOrigin)
}

/**
 * The sandbox's own message, if `event` is one: its origin checked, and the
 * `type` it carries (`artifact-sandbox-ready`, `-rendered`, `-error`, …).
 */
export function sandboxMessageType(event: MessageEvent): string | null {
  if (
    IS_WEB_CLIENT ? event.origin !== 'null' : event.origin !== ARTIFACT_ORIGIN
  )
    return null
  const data = event.data as { type?: unknown } | null
  return typeof data === 'object' && data && typeof data.type === 'string'
    ? data.type
    : null
}
