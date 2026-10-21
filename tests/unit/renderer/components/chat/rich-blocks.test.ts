// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }
// A reply's illustrated steps and stock chart are drawn in place of their
// fences: steps with only the run's own search thumbnails as pictures, the
// chart as TradingView's embed in a sandboxed frame that falls back to a card
// when it cannot load. Copy takes the block's words.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type {
  ChatMessage,
  SendMessageOptions,
  TurnBlock
} from '@actovia/shared/types/chat'
import type { EntitySummary } from '@actovia/shared/types/entity'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import {
  tradingViewEmbedUrl,
  tradingViewSymbolPageUrl
} from '@actovia/shared/utils/stock-chart'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Provider as JotaiProvider } from 'jotai'
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key
const i18n = { resolvedLanguage: 'en', language: 'en' }
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n }) }))
// The real one observes the viewport; here a picture is an <img>.
vi.mock('@/components/markdown/lazy-load-image', () => ({
  LazyLoadImage: ({ src, alt }: { src: string; alt: string }) =>
    createElement('img', { src, alt, 'data-lazy': '' })
}))
const handleCopy = vi.fn()
vi.mock('@/hooks/use-clipboard', () => ({
  useClipboard: () => ({ copied: null, handleCopy })
}))
vi.mock('@/components/chat/audio-player', () => ({ default: () => null }))
const getEntitySummary =
  vi.fn<(title: string, lang: string) => Promise<EntitySummary>>()
vi.mock('@/services/entity-service', () => ({
  getEntitySummary: (title: string, lang: string) =>
    getEntitySummary(title, lang)
}))

const { default: Markdown } = await import('@/components/markdown/markdown')
const {
  InteractiveProvider,
  InteractiveTurnContext,
  TurnTextAboveContext,
  turnTextsAbove,
  useInteractiveTurn
} = await import('@/components/chat/interactive/interactive-context')
const { MessageAction } = await import('@/components/chat/message-action')
const { EntityPanel, markdownUrlTransform } =
  await import('@/components/chat/interactive/entity-link')

const STEPS = {
  title: 'Replacing the strings',
  steps: [
    {
      text: 'Loosen the old string.',
      image: 'https://imgs.search.brave.com/peg.jpg'
    },
    {
      text: 'Thread the new one.',
      image: 'https://cdn.example.com/original/bridge.jpg'
    },
    {
      text: 'Tune up slowly.',
      image: 'https://imgs.search.brave.com/not-from-this-run.jpg'
    },
    { text: 'Stretch it.' }
  ]
}
const STOCK = {
  symbol: 'NASDAQ:AAPL',
  range: '12M',
  note: 'Up 12% since the call.'
}
// A search this run made: a page with a thumbnail, and an image result whose
// original is the second step's picture.
const RESULTS: WebSearchResult[] = [
  {
    rank: 1,
    link: 'https://guitars.example/strings',
    title: 'Restringing',
    content: '',
    snippet: '',
    thumbnail: 'https://imgs.search.brave.com/peg.jpg',
    media: [
      {
        kind: 'image',
        title: 'bridge',
        url: 'https://cdn.example.com/original/bridge.jpg',
        sourceUrl: 'https://guitars.example/strings',
        thumbnailUrl: 'https://imgs.search.brave.com/bridge-thumb.jpg'
      }
    ]
  }
]

const fence = (language: string, value: unknown) =>
  `\`\`\`${language}\n${JSON.stringify(value)}\n\`\`\``

function Turn({
  body,
  results
}: {
  body: string
  results?: WebSearchResult[]
}) {
  const turn = useInteractiveTurn('run-1', body)
  const above = turnTextsAbove([
    { kind: 'text', key: 't0', text: body } as TurnBlock
  ])
  return createElement(
    InteractiveTurnContext.Provider,
    { value: turn },
    createElement(
      TurnTextAboveContext.Provider,
      { value: above[0] },
      createElement(Markdown, { src: body, webSearchResults: results })
    )
  )
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const send = vi.fn(async (_opts: SendMessageOptions) => {})
const messages: ChatMessage[] = []

// happy-dom reports on the console each frame it was told not to load (the
// chart's); anything else still prints.
const consoleError = console.error.bind(console)
vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (args[0] instanceof DOMException && args[0].name === 'NotSupportedError')
    return
  consoleError(...args)
})

beforeEach(() => {
  handleCopy.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const show = (node: ReactElement) =>
  act(async () =>
    root.render(
      createElement(
        JotaiProvider,
        null,
        createElement(
          InteractiveProvider,
          { messages, status: 'idle', send },
          node
        )
      )
    )
  )
const byId = (id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const allById = (id: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`))

describe('illustrated steps in a reply', () => {
  it('are drawn as a numbered list in place of the code, with the title', async () => {
    await show(
      createElement(Turn, {
        body: `How to:\n\n${fence('actovia-steps', STEPS)}`,
        results: RESULTS
      })
    )
    expect(byId(TEST_IDS.chat.richBlocks.steps)).not.toBeNull()
    expect(host.querySelector('pre')).toBeNull()
    expect(allById(TEST_IDS.chat.richBlocks.step)).toHaveLength(4)
    expect(host.textContent).toContain('Replacing the strings')
    expect(host.textContent).toContain('Tune up slowly.')
  })

  it("draws a picture only when it is one of the run's search thumbnails", async () => {
    await show(
      createElement(Turn, {
        body: fence('actovia-steps', STEPS),
        results: RESULTS
      })
    )
    const pictures = allById(TEST_IDS.chat.richBlocks.stepImage)
    expect(pictures).toHaveLength(1)
    expect(pictures[0].querySelector('img')?.getAttribute('src')).toBe(
      'https://imgs.search.brave.com/peg.jpg'
    )
    // The second step's picture is an image result's *original*: not a thumbnail, not drawn.
    expect(host.innerHTML).not.toContain('original/bridge.jpg')
    // The third is a Brave URL this run never returned.
    expect(host.innerHTML).not.toContain('not-from-this-run')
    // No placeholder either: a dropped picture is nothing, not a "Load image" button.
    expect(byId(TEST_IDS.chat.remoteImage.placeholder)).toBeNull()
  })

  it('draws no pictures when the run searched nothing', async () => {
    await show(createElement(Turn, { body: fence('actovia-steps', STEPS) }))
    expect(allById(TEST_IDS.chat.richBlocks.step)).toHaveLength(4)
    expect(allById(TEST_IDS.chat.richBlocks.stepImage)).toHaveLength(0)
  })

  it('a second block in the reply stays code', async () => {
    await show(
      createElement(Turn, {
        body: `${fence('actovia-steps', STEPS)}\n\n${fence('actovia-stock', STOCK)}`
      })
    )
    expect(byId(TEST_IDS.chat.richBlocks.steps)).not.toBeNull()
    expect(byId(TEST_IDS.chat.richBlocks.stock)).toBeNull()
    expect(host.querySelector('pre')).not.toBeNull()
  })
})

describe('a stock chart in a reply', () => {
  it("is TradingView's embed in a sandboxed frame, with the note and the symbol's page under it", async () => {
    await show(createElement(Turn, { body: fence('actovia-stock', STOCK) }))
    const frame = byId(TEST_IDS.chat.richBlocks.stockFrame)
    expect(frame?.getAttribute('src')).toBe(
      tradingViewEmbedUrl({
        symbol: 'NASDAQ:AAPL',
        range: '12M',
        theme: 'light',
        locale: 'en'
      })
    )
    expect(frame?.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin'
    )
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer')
    // Its page declares no color-scheme; a dark frame would paint it on white.
    expect(frame?.className).toContain('[color-scheme:light]')
    expect(frame?.getAttribute('height')).toBe('380')
    expect(host.textContent).toContain('Up 12% since the call.')
    expect(host.textContent).toContain('richBlocks.chartBy')
    const link = host.querySelector<HTMLAnchorElement>('a[target="_blank"]')
    expect(link?.getAttribute('href')).toBe(
      tradingViewSymbolPageUrl('NASDAQ:AAPL')
    )
    expect(host.querySelector('pre')).toBeNull()
  })

  it('takes 1D when the block names no range', async () => {
    await show(
      createElement(Turn, {
        body: fence('actovia-stock', { symbol: 'NYSE:BRK.B' })
      })
    )
    expect(
      byId(TEST_IDS.chat.richBlocks.stockFrame)?.getAttribute('src')
    ).toContain('%7C1D%22%5D%5D')
  })

  it('falls back to a card when the frame fails', async () => {
    await show(createElement(Turn, { body: fence('actovia-stock', STOCK) }))
    await act(async () => {
      byId(TEST_IDS.chat.richBlocks.stockFrame)?.dispatchEvent(
        new Event('error')
      )
    })
    expect(byId(TEST_IDS.chat.richBlocks.stockFrame)).toBeNull()
    const fallback = byId(TEST_IDS.chat.richBlocks.stockFallback)
    expect(fallback?.textContent).toContain('NASDAQ:AAPL')
    expect(fallback?.textContent).toContain('richBlocks.chartUnavailable')
    expect(byId(TEST_IDS.chat.richBlocks.stock)?.dataset.state).toBe('failed')
    // The note and the page link stay.
    expect(host.textContent).toContain('Up 12% since the call.')
  })

  it('falls back when the frame says nothing for ten seconds', async () => {
    vi.useFakeTimers()
    try {
      await show(createElement(Turn, { body: fence('actovia-stock', STOCK) }))
      await act(async () => {
        vi.advanceTimersByTime(10_001)
      })
      expect(byId(TEST_IDS.chat.richBlocks.stockFallback)).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back at once when the app is offline', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      await show(createElement(Turn, { body: fence('actovia-stock', STOCK) }))
      expect(byId(TEST_IDS.chat.richBlocks.stockFallback)).not.toBeNull()
      expect(byId(TEST_IDS.chat.richBlocks.stockFrame)).toBeNull()
    } finally {
      onLine.mockRestore()
    }
  })

  it('re-arms when the chart URL changes', async () => {
    await show(createElement(Turn, { body: fence('actovia-stock', STOCK) }))
    await act(async () => {
      byId(TEST_IDS.chat.richBlocks.stockFrame)?.dispatchEvent(
        new Event('error')
      )
    })
    expect(byId(TEST_IDS.chat.richBlocks.stockFallback)).not.toBeNull()
    await show(
      createElement(Turn, {
        body: fence('actovia-stock', { ...STOCK, range: '1M' })
      })
    )
    expect(byId(TEST_IDS.chat.richBlocks.stockFallback)).toBeNull()
    expect(
      byId(TEST_IDS.chat.richBlocks.stockFrame)?.getAttribute('src')
    ).toContain('%7C1M%22%5D%5D')
    expect(byId(TEST_IDS.chat.richBlocks.stock)?.dataset.state).toBe('loading')
  })

  it('a symbol the widget would not take stays code', async () => {
    await show(
      createElement(Turn, {
        body: fence('actovia-stock', { symbol: 'nasdaq:aapl' })
      })
    )
    expect(byId(TEST_IDS.chat.richBlocks.stock)).toBeNull()
    expect(host.querySelector('pre')).not.toBeNull()
  })
})

describe('copy and read aloud take the block’s words', () => {
  it("Copy writes the stock block's symbol and note, not its JSON", async () => {
    const content = `Here:\n\n${fence('actovia-stock', STOCK)}`
    await show(createElement(MessageAction, { content }))
    const row = byId(TEST_IDS.chat.messageAction)
    // The copy button sits inside the tooltip's trigger button.
    await act(async () => row?.querySelector('button button')?.click())
    expect(handleCopy).toHaveBeenCalledTimes(1)
    const copied = handleCopy.mock.calls[0]![0] as string
    expect(copied).toContain('NASDAQ:AAPL — Up 12% since the call.')
    expect(copied).not.toContain('actovia-stock')
  })
})

describe('an entity link in a reply', () => {
  it('is a button that opens the panel, never an anchor to entity:', async () => {
    await show(
      createElement(Turn, {
        body: 'Ask [Marie Curie](entity:Marie_Curie) or [Kyoto](entity:Kyoto).'
      })
    )
    const links = allById(TEST_IDS.chat.richBlocks.entityLink)
    expect(links.map((l) => l.dataset.entity)).toEqual(['Marie_Curie', 'Kyoto'])
    expect(links[0].tagName).toBe('BUTTON')
    expect(links[0].textContent).toBe('Marie Curie')
    expect(host.querySelector('a[href^="entity:"]')).toBeNull()
  })

  it.each([
    'entity:../x',
    'entity:Marie%20Curie',
    `entity:${'a'.repeat(201)}`,
    'entity:Marie%2FCurie',
    'entity:'
  ])('a target that is not a title (%s) is plain text', async (href) => {
    await show(createElement(Turn, { body: `See [this](${href}) now.` }))
    expect(allById(TEST_IDS.chat.richBlocks.entityLink)).toHaveLength(0)
    expect(host.querySelector('a')).toBeNull()
    expect(host.textContent).toContain('See this now.')
  })

  it('an entity: target is not a picture source', async () => {
    await show(createElement(Turn, { body: '![x](entity:Marie_Curie)' }))
    expect(allById(TEST_IDS.chat.richBlocks.entityLink)).toHaveLength(0)
    expect(host.querySelector('[src*="entity:"]')).toBeNull()
    // The rule itself: an entity: target passes only as a link's href.
    expect(markdownUrlTransform('entity:Marie_Curie', 'src')).toBe('')
    expect(markdownUrlTransform('entity:Marie_Curie', 'href')).toBe(
      'entity:Marie_Curie'
    )
  })

  it('an ordinary link is still a link', async () => {
    await show(
      createElement(Turn, {
        body: '[Wikipedia](https://en.wikipedia.org/wiki/Marie_Curie)'
      })
    )
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      'https://en.wikipedia.org/wiki/Marie_Curie'
    )
  })
})

describe('the entity panel', () => {
  const client = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // react-query answers a tick or more after the render: wait until the
  // panel has left "loading".
  const settled = () =>
    vi.waitFor(async () => {
      await act(async () => {})
      expect(
        byId(TEST_IDS.chat.richBlocks.entityPanel)?.textContent
      ).not.toContain('richBlocks.entityLoading')
    })
  const panel = (title: string) =>
    createElement(
      QueryClientProvider,
      { client: client() },
      createElement(EntityPanel, { title })
    )

  it("asks the computer for the title in the app's Wikipedia language and draws the summary", async () => {
    getEntitySummary.mockResolvedValue({
      title: 'Marie Curie',
      extract: 'Polish and naturalised-French physicist.',
      description: 'Physicist (1867–1934)',
      thumbnail: {
        source: 'https://upload.wikimedia.org/x.jpg',
        width: 330,
        height: 448
      },
      url: 'https://en.wikipedia.org/wiki/Marie_Curie',
      lang: 'en'
    })
    await show(panel('Marie_Curie'))
    await settled()
    expect(getEntitySummary).toHaveBeenCalledWith('Marie_Curie', 'en')
    const node = byId(TEST_IDS.chat.richBlocks.entityPanel)
    expect(node?.textContent).toContain('Marie Curie')
    expect(node?.textContent).toContain(
      'Polish and naturalised-French physicist.'
    )
    expect(node?.querySelector('img')?.getAttribute('src')).toBe(
      'https://upload.wikimedia.org/x.jpg'
    )
    expect(node?.querySelector('a')?.getAttribute('href')).toBe(
      'https://en.wikipedia.org/wiki/Marie_Curie'
    )
    expect(node?.textContent).toContain('richBlocks.readMore')
  })

  it('says when Wikipedia has nothing, and when it could not be reached', async () => {
    getEntitySummary.mockResolvedValue({
      title: 'Nobody Here',
      extract: null,
      description: null,
      thumbnail: null,
      url: null,
      lang: 'en'
    })
    await show(panel('Nobody_Here'))
    await settled()
    expect(byId(TEST_IDS.chat.richBlocks.entityPanel)?.textContent).toContain(
      'richBlocks.entityNothing'
    )

    getEntitySummary.mockRejectedValue(new Error('HTTP 503'))
    await show(panel('Marie_Curie'))
    await settled()
    expect(byId(TEST_IDS.chat.richBlocks.entityPanel)?.textContent).toContain(
      'richBlocks.entityFailed'
    )
  })

  it('cuts a long extract at 600 characters', async () => {
    getEntitySummary.mockResolvedValue({
      title: 'X',
      extract: 'y'.repeat(700),
      description: null,
      thumbnail: null,
      url: null,
      lang: 'en'
    })
    await show(panel('X'))
    await settled()
    expect(byId(TEST_IDS.chat.richBlocks.entityPanel)?.textContent).toContain(
      'y'.repeat(600) + '…'
    )
    expect(
      byId(TEST_IDS.chat.richBlocks.entityPanel)?.textContent
    ).not.toContain('y'.repeat(601))
  })
})
