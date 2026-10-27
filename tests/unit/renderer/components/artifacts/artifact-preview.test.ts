// @vitest-environment happy-dom
// ISSUE-265: a card on the Artifacts page draws its page — the chat card's
// own sandbox, scaled down, mounted only while the card is near the screen.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-artifacts', () => ({
  useArtifactCode: (_c: string, _a: string, enabled: boolean) => ({
    data: enabled
      ? { title: 'Kyoto', code: 'export default () => null' }
      : undefined
  })
}))

let observed: ((visible: boolean) => void) | null = null
class FakeObserver {
  constructor(private cb: IntersectionObserverCallback) {}
  observe() {
    observed = (visible) =>
      this.cb(
        [{ isIntersecting: visible } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver
      )
  }
  disconnect() {
    observed = null
  }
}

const { ArtifactPreview } =
  await import('@/components/artifacts/artifact-preview')
const { ARTIFACT_ORIGIN } =
  await import('@/components/calling-tools/artifact/sandbox-frame')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root.render(
      createElement(ArtifactPreview, {
        chatId: 'c1',
        artifactId: 'art-1',
        title: 'Kyoto'
      })
    )
  )
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const frame = () => container.querySelector('iframe')

/** happy-dom loads no frame: give the mounted one a window to post to. */
function stubWindow(f: HTMLIFrameElement) {
  const win = { postMessage: vi.fn() } as unknown as Window
  Object.defineProperty(f, 'contentWindow', { value: win })
  return win
}

function fromSandbox(type: string, source: Window | null) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type },
        origin: ARTIFACT_ORIGIN,
        source
      })
    )
  })
}

describe('ArtifactPreview', () => {
  it('mounts no frame until the card is near the screen, and drops it after', () => {
    expect(frame()).toBeNull()
    act(() => observed?.(true))
    expect(frame()).not.toBeNull()
    act(() => observed?.(false))
    expect(frame()).toBeNull()
  })

  it('is out of reach: hidden from assistive tech, the tab order and the pointer', () => {
    act(() => observed?.(true))
    const f = frame()!
    expect(f.getAttribute('aria-hidden')).toBe('true')
    expect(f.tabIndex).toBe(-1)
    expect(f.className).toContain('pointer-events-none')
    expect(f.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
  })

  it('hands the sandbox the code on its handshake and shows once it has rendered', () => {
    act(() => observed?.(true))
    const f = frame()!
    const win = stubWindow(f)
    const post = vi.mocked(win.postMessage)
    fromSandbox('artifact-sandbox-ready', win)
    expect(post).toHaveBeenCalledWith(
      {
        type: 'render',
        code: 'export default () => null',
        artifactId: 'Kyoto'
      },
      ARTIFACT_ORIGIN
    )
    expect(f.dataset.state).toBe('loading')
    fromSandbox('artifact-sandbox-rendered', win)
    expect(f.dataset.state).toBe('rendered')
  })

  it('ignores another frame’s messages', () => {
    act(() => observed?.(true))
    const f = frame()!
    const post = vi.mocked(stubWindow(f).postMessage)
    fromSandbox('artifact-sandbox-ready', window)
    fromSandbox('artifact-sandbox-rendered', window)
    expect(post).not.toHaveBeenCalled()
    expect(f.dataset.state).toBe('loading')
  })
})
