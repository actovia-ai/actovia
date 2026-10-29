// @vitest-environment happy-dom
// The composer's voice glow: lit from the recorder's own stream while a voice
// message is recorded, and nowhere else.
import { createStore, Provider } from 'jotai'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))
vi.mock('@/components/ui/toast', () => {
  // `toast.add({ type, ...options })` → the spy for that type.
  const byType: Record<string, (options: unknown) => void> = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn()
  }
  return {
    toast: {
      add: ({ type, ...options }: { type: string }) => byType[type]?.(options)
    }
  }
})
let beam: Record<string, unknown> = {}
vi.mock('border-beam', () => ({
  BorderBeam: ({
    children,
    ...props
  }: Record<string, unknown> & { children?: ReactNode }) => {
    beam = props
    return createElement('div', null, children)
  }
}))
let resolvedTheme = 'light'
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme }) }))
vi.mock('react-router', () => ({ useParams: () => ({ id: 'chat-1' }) }))
vi.mock('@/hooks/use-upload', () => ({
  useUpload: () => ({ uploadFile: vi.fn() })
}))
vi.mock('@/hooks/use-audio', () => ({
  useAudio: () => ({ data: null, loading: false, speechToText: vi.fn() })
}))
vi.mock('@/components/chat/composer/composer-tools', () => ({
  ActiveToolPills: () => null,
  ComposerToolsButton: () => null
}))
vi.mock('@/components/chat/composer/file-preview', () => ({
  FilePreview: () => null
}))
// The library paints with Web Audio, canvas and rAF: stood in for by a div
// that keeps the props it was last given.
type GlowProps = Record<string, unknown> & { children?: ReactNode }
let glow: GlowProps = {}
vi.mock('voice-glow', () => ({
  VoiceBeam: ({ children, ...props }: GlowProps) => {
    glow = props
    return createElement('div', { 'data-glow': '' }, children)
  }
}))

const { chatInputAtom } = await import('@/stores/input')
const { default: InputBox } =
  await import('@/components/chat/composer/composer')

// A recorder that records nothing, and calls back on stop as the real one.
class FakeRecorder {
  mimeType = 'audio/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  state: 'inactive' | 'recording' = 'inactive'
  static isTypeSupported = () => true
  constructor(readonly stream: MediaStream) {}
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.onstop?.()
  }
}

let stream: MediaStream
let track: { stop: ReturnType<typeof vi.fn> }
let getUserMedia: ReturnType<typeof vi.fn>
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let store: ReturnType<typeof createStore>

beforeEach(() => {
  glow = {}
  resolvedTheme = 'light'
  track = { stop: vi.fn() }
  stream = { getTracks: () => [track] } as unknown as MediaStream
  getUserMedia = vi.fn(() => Promise.resolve(stream))
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia }
  })
  store = createStore()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const show = () =>
  act(async () =>
    root.render(
      createElement(
        Provider,
        { store },
        createElement(InputBox, { chatId: 'chat-1', sendMessage: vi.fn() })
      )
    )
  )
const button = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const press = (label: string) => act(async () => button(label).click())

describe('the composer voice glow', () => {
  it('is dark while nothing is being recorded', async () => {
    await show()

    expect(glow.active).toBe(false)
    expect(glow.stream).toBeNull()
  })

  it('lights from the recorder’s own stream, and goes out on stop', async () => {
    await show()

    await press('recorder.dictate')

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(glow.active).toBe(true)
    expect(glow.stream).toBe(stream)

    await press('recorder.stopRecording')

    expect(glow.active).toBe(false)
    expect(glow.stream).toBeNull()
  })

  it('keeps recording while the user types: the stop stays, and so does the glow', async () => {
    await show()
    await press('recorder.dictate')

    await act(async () => store.set(chatInputAtom, 'hello'))

    expect(glow.active).toBe(true)
    expect(button('recorder.stopRecording')).not.toBeNull()
    expect(track.stop).not.toHaveBeenCalled()

    await press('recorder.stopRecording')
    expect(track.stop).toHaveBeenCalled()
    expect(glow.active).toBe(false)
  })

  it('stops the microphone when the composer goes mid-recording', async () => {
    await show()
    await press('recorder.dictate')

    await act(async () => root.unmount())

    expect(track.stop).toHaveBeenCalled()
    root = createRoot(host)
  })

  it('wraps the pill without moving it, and carries its shadow', async () => {
    await show()

    expect(glow.borderRadius).toBe(28)
    // Its own clip stays: left visible, the bloom showed past the pill.
    expect(glow.style).toBeUndefined()
    expect(glow.className).toContain('rounded-[28px]')
    expect(glow.className).toContain('shadow-')
    const pill = host.querySelector('[data-glow] > div')
    expect(pill?.className).toContain('rounded-[28px]')
    expect(pill?.className).not.toContain('shadow-')
  })

  it('takes the idle beam’s place while recording, and gives it back', async () => {
    await show()
    expect(beam.active).toBe(true)

    await press('recorder.dictate')
    expect(beam.active).toBe(false)

    await press('recorder.stopRecording')
    expect(beam.active).toBe(true)
  })

  it('says it is listening in the field while recording', async () => {
    await show()
    const field = () => host.querySelector('textarea')
    expect(field()?.getAttribute('placeholder')).toBe('composer.placeholder')

    await press('recorder.dictate')
    expect(field()?.getAttribute('placeholder')).toBe('composer.listening')

    await press('recorder.stopRecording')
    expect(field()?.getAttribute('placeholder')).toBe('composer.placeholder')
  })

  it.each(['light', 'dark'])('takes the %s theme', async (theme) => {
    resolvedTheme = theme
    await show()

    expect(glow.theme).toBe(theme)
  })

  it('leaves reduced motion to the library, overriding none of it', async () => {
    await show()
    await press('recorder.dictate')

    // The library stops its breathing, flow, warp and hue drift under
    // prefers-reduced-motion; a motion or drift prop here would bypass that.
    for (const prop of ['motion', 'flow', 'hueDuration', 'paused']) {
      expect(glow[prop]).toBeUndefined()
    }
  })
})
