// @vitest-environment happy-dom
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { ChatToolResultMessage } from '@actovia/shared/types/chat'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}(${Object.values(opts).join(',')})` : key
  })
}))
const settings: { image?: { size?: string; generatedCounts?: number } } = {}
vi.mock('@/hooks/use-settings', () => ({
  useSettings: () => ({ data: settings })
}))
vi.mock('react-medium-image-zoom', () => ({
  default: ({ children }: { children: unknown }) => children
}))
// Whether motion/react reports `prefers-reduced-motion: reduce`.
const motionPrefs = { reduce: false }
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => motionPrefs.reduce
}))

const {
  ImageGenerationCard,
  imageGenerationStatus,
  imageSrcOf,
  parseImageSize
} =
  await import('@/components/calling-tools/image-generation/image-generation-card')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// happy-dom has no 2D canvas: a context that only counts dots, so the
// dither field's effect runs.
const dots = { drawn: 0 }
beforeAll(() => {
  const g = globalThis as { ResizeObserver?: unknown }
  g.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  }
  HTMLCanvasElement.prototype.getContext = function () {
    return {
      setTransform() {},
      clearRect() {},
      beginPath() {},
      arc() {
        dots.drawn += 1
      },
      fill() {},
      globalAlpha: 1,
      fillStyle: ''
    }
  } as unknown as HTMLCanvasElement['getContext']
})

let root: Root | null = null
let host: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  motionPrefs.reduce = false
  delete settings.image
  vi.restoreAllMocks()
})

function render(props: { prompt: string; result?: ChatToolResultMessage }) {
  if (!root) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  }
  act(() => root!.render(createElement(ImageGenerationCard, props)))
  return host
}

const frames = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLElement>(
    `[data-testid="${TEST_IDS.imageGeneration.card}"]`
  )
]

function result(details: unknown, isError = false): ChatToolResultMessage {
  return {
    id: 't1',
    runId: 'r1',
    role: 'toolResult',
    toolCallId: 'c1',
    toolName: 'image_generation',
    isError,
    content: [{ type: 'text', text: isError ? 'No key' : '{}' }],
    details,
    timestamp: 2
  } as ChatToolResultMessage
}

describe('imageGenerationStatus', () => {
  it('maps pending → generating, an error → error, a result → complete', () => {
    expect(imageGenerationStatus()).toBe('generating')
    expect(imageGenerationStatus(result(null, true))).toBe('error')
    expect(imageGenerationStatus(result({ images: [] }))).toBe('complete')
  })
})

describe('parseImageSize', () => {
  it('reads WxH, and falls back to a square with no badge', () => {
    expect(parseImageSize('1024x1536')).toEqual({
      aspectRatio: '1024 / 1536',
      resolution: '1024 × 1536'
    })
    expect(parseImageSize('auto')).toEqual({ aspectRatio: '1 / 1' })
    expect(parseImageSize(null)).toEqual({ aspectRatio: '1 / 1' })
  })
})

const CHAT = '11111111-1111-4111-8111-111111111111'
const MEDIA = '22222222-2222-4222-8222-222222222222.png'

describe('imageSrcOf', () => {
  it('points a saved image at the local media route', () => {
    expect(
      imageSrcOf({ mediaId: MEDIA, chatId: CHAT, mimeType: 'image/png' })
    ).toBe(`http://localhost:60223/api/v1/media/${CHAT}/${MEDIA}`)
  })

  it('has nothing to show for a saved image with no chat, or a row with no file', () => {
    expect(
      imageSrcOf({ mediaId: MEDIA, mimeType: 'image/png' })
    ).toBeUndefined()
    expect(imageSrcOf({ chatId: CHAT })).toBeUndefined()
    expect(imageSrcOf({})).toBeUndefined()
  })
})

describe('ImageGenerationCard', () => {
  it('loads a saved image from the local media route', () => {
    const el = render({
      prompt: 'a fox',
      result: result({
        images: [
          {
            mediaId: MEDIA,
            chatId: CHAT,
            mimeType: 'image/png',
            width: 1024,
            height: 1536,
            revisedPrompt: 'a red fox'
          }
        ]
      })
    })
    const [frame] = frames(el)
    expect(frame.dataset.state).toBe('complete')
    const img = frame.querySelector('img')
    expect(img?.getAttribute('src')).toBe(
      `http://localhost:60223/api/v1/media/${CHAT}/${MEDIA}`
    )
    expect(img?.getAttribute('alt')).toBe('a red fox')
  })

  it('shows a pending call as generating, with its prompt and the size the settings ask for', () => {
    settings.image = { size: '1024x1536' }
    const el = render({ prompt: 'a fox in snow' })
    const [frame] = frames(el)

    expect(frame.dataset.state).toBe('generating')
    expect(frame.getAttribute('aria-busy')).toBe('true')
    expect(el.textContent).toContain('imageGeneration.status.generating')
    expect(el.textContent).toContain(
      'imageGeneration.quotedPrompt(a fox in snow)'
    )
    expect(el.textContent).toContain('1024 × 1536')
    expect(el.querySelector('img')).toBeNull()
  })

  it('shows one placeholder per image the settings ask for', () => {
    settings.image = { generatedCounts: 3 }
    expect(frames(render({ prompt: 'x' }))).toHaveLength(3)
  })

  it('resolves the same frame into the finished image when the result lands', () => {
    const el = render({ prompt: 'a fox' })
    const before = frames(el)[0]

    render({
      prompt: 'a fox',
      result: result({
        images: [
          {
            mediaId: MEDIA,
            chatId: CHAT,
            mimeType: 'image/png',
            revisedPrompt: 'a red fox'
          }
        ],
        size: '1536x1024'
      })
    })
    const [after] = frames(el)

    expect(after).toBe(before)
    expect(after.dataset.state).toBe('complete')
    expect(after.getAttribute('aria-busy')).toBe('false')
    const img = after.querySelector('img')
    expect(img?.getAttribute('src')).toBe(
      `http://localhost:60223/api/v1/media/${CHAT}/${MEDIA}`
    )
    expect(img?.getAttribute('alt')).toBe('a red fox')
    // The recorded size wins over the settings once there is one.
    expect(el.textContent).toContain('1536 × 1024')
  })

  it('shows a failed call as an error, with no retry', () => {
    const el = render({ prompt: 'a fox', result: result(null, true) })
    const [frame] = frames(el)

    expect(frame.dataset.state).toBe('error')
    expect(el.textContent).toContain('imageGeneration.status.error')
    expect(el.querySelector('button')).toBeNull()
  })

  it('says the image is unavailable when a result names no saved file', () => {
    const el = render({ prompt: 'a fox', result: result({ images: [{}] }) })
    const [frame] = frames(el)

    expect(frame.dataset.state).toBe('error')
    expect(el.textContent).toContain('imageGeneration.status.unavailable')
    expect(el.querySelector('img')).toBeNull()
  })

  it('animates the field and the blur, unless reduced motion is on', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const scheduledDraw = () =>
      raf.mock.calls.some(([cb]) => (cb as { name?: string }).name === 'draw')

    const el = render({ prompt: 'a fox' })
    expect(scheduledDraw()).toBe(true)
    expect(el.innerHTML).toContain('blur(')

    act(() => root?.unmount())
    root = null
    raf.mockClear()
    dots.drawn = 0
    motionPrefs.reduce = true

    const still = render({ prompt: 'a fox' })
    // One still frame of dots, never a loop, and no blur/scale on the media.
    expect(dots.drawn).toBeGreaterThan(0)
    expect(scheduledDraw()).toBe(false)
    expect(still.innerHTML).not.toContain('blur(')
  })
})
