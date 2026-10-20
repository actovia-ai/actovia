// @vitest-environment happy-dom
// An attachment in the transcript can be saved: a download button at its
// corner (hover / focus), one in the zoomed view and the lightbox, and the
// native menu on right-click — each a call to the main process, which shows
// the save dialog.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { ATTACHMENT_CHANNELS } from '@actovia/shared/types/attachment-actions'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const t = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))
vi.mock('@/components/markdown/source-favicon', () => ({
  SourceFavicon: () => null
}))
vi.mock('@/components/markdown/lazy-load-image', () => ({
  LazyLoadImage: ({ src }: { src: string }) => createElement('img', { src })
}))
vi.mock('react-medium-image-zoom', () => ({
  default: ({ children }: { children: unknown }) => children
}))
const toast = { success: vi.fn(), error: vi.fn() }
vi.mock('sileo', () => ({ sileo: toast }))

const invoke = vi.fn()
;(window as unknown as { electron: unknown }).electron = {
  ipcRenderer: { invoke }
}

const { AttachmentFrame, ZoomToolbar } =
  await import('@/components/chat/attachment-frame')
const { ImageGallery } = await import('@/components/web-search/image-gallery')
const { ImageLightbox } = await import('@/components/web-search/image-lightbox')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const IMAGE = { url: 'data:image/png;base64,AAAA', kind: 'image' } as const
const SEARCH_IMAGE = {
  url: 'https://site.example/original.jpg',
  thumbnailUrl: 'https://imgs.search.brave.com/copy',
  title: 'A red fox',
  sourceUrl: 'https://site.example/page'
}

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ status: 'cancelled' })
  toast.success.mockReset()
  toast.error.mockReset()
})
afterEach(() => {
  document.body.innerHTML = ''
})

async function render(element: ReturnType<typeof createElement>) {
  const host = document.createElement('div')
  document.body.append(host)
  await act(async () => createRoot(host).render(element))
  return host
}

const byTestId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`)

describe('<AttachmentFrame>', () => {
  it('has a labelled download button that asks main to save the attachment', async () => {
    await render(
      createElement(
        AttachmentFrame,
        { attachment: IMAGE },
        createElement('img', { src: IMAGE.url })
      )
    )
    const button = byTestId(TEST_IDS.attachment.download)
    expect(button?.tagName).toBe('BUTTON')
    expect(button?.getAttribute('aria-label')).toBe('attachment.download')
    // Hidden until hover or focus, but reachable from the keyboard.
    expect(button?.className).toContain('opacity-0')
    expect(button?.className).toContain(
      'group-focus-within/attachment:opacity-100'
    )
    expect(button?.tabIndex).not.toBe(-1)

    await act(async () => button?.click())
    expect(invoke).toHaveBeenCalledWith(ATTACHMENT_CHANNELS.save, IMAGE)
  })

  it('opens the native menu on right-click', async () => {
    const host = await render(
      createElement(
        AttachmentFrame,
        { attachment: IMAGE },
        createElement('img', { src: IMAGE.url })
      )
    )
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true
    })
    await act(async () => host.querySelector('img')?.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    expect(invoke).toHaveBeenCalledWith(ATTACHMENT_CHANNELS.contextMenu, IMAGE)
  })

  it('says when a copy worked or a save failed, and nothing on cancel', async () => {
    const host = await render(
      createElement(
        AttachmentFrame,
        { attachment: IMAGE },
        createElement('img', { src: IMAGE.url })
      )
    )
    const rightClick = () =>
      act(async () =>
        host
          .querySelector('img')
          ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
      )

    await rightClick()
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()

    invoke.mockResolvedValueOnce({ status: 'copied' })
    await rightClick()
    expect(toast.success).toHaveBeenCalledWith({
      title: 'attachment.copied'
    })

    invoke.mockResolvedValueOnce({
      status: 'failed',
      reason: 'unsupported-image',
      action: 'copy'
    })
    await rightClick()
    expect(toast.error).toHaveBeenLastCalledWith({
      title: 'attachment.copyFailed'
    })

    invoke.mockResolvedValueOnce({
      status: 'failed',
      reason: 'write-failed',
      action: 'save'
    })
    await rightClick()
    expect(toast.error).toHaveBeenLastCalledWith({
      title: 'attachment.saveFailed'
    })
  })
})

describe('the zoomed view', () => {
  it('has a download button in its toolbar', async () => {
    await render(
      createElement(ZoomToolbar, {
        attachment: IMAGE,
        buttonUnzoom: createElement('button', { 'data-unzoom': '' }),
        img: createElement('img', { src: IMAGE.url })
      })
    )
    expect(document.querySelector('[data-unzoom]')).not.toBeNull()
    await act(async () => byTestId(TEST_IDS.attachment.zoomDownload)?.click())
    expect(invoke).toHaveBeenCalledWith(ATTACHMENT_CHANNELS.save, IMAGE)
  })
})

describe('search images', () => {
  const expected = {
    url: SEARCH_IMAGE.thumbnailUrl,
    name: SEARCH_IMAGE.title,
    kind: 'image'
  }

  it('save the copy on screen from the grid, without opening the lightbox', async () => {
    await render(createElement(ImageGallery, { images: [SEARCH_IMAGE] }))
    await act(async () => byTestId(TEST_IDS.attachment.download)?.click())
    expect(invoke).toHaveBeenCalledWith(ATTACHMENT_CHANNELS.save, expected)
    expect(byTestId(TEST_IDS.gallery.lightboxClose)).toBeNull()
  })

  it('save from the lightbox toolbar', async () => {
    await render(
      createElement(ImageLightbox, {
        images: [SEARCH_IMAGE],
        index: 0,
        onIndexChange: vi.fn(),
        onClose: vi.fn()
      })
    )
    await act(async () => byTestId(TEST_IDS.gallery.lightboxDownload)?.click())
    expect(invoke).toHaveBeenCalledWith(ATTACHMENT_CHANNELS.save, expected)
  })
})
