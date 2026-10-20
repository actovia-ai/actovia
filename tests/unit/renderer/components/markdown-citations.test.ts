// @vitest-environment happy-dom
// The chip as drawn: one link per place cited, reading its first source and
// how many stand behind it.
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))

// The hover card's own behaviour (hover, portal, placement) is Base UI's:
// here the card is always open and drawn in place, so what is tested is what
// it shows. `closeCard` stands for the pointer leaving.
let closeCard: (() => void) | undefined
vi.mock('@/components/ui/hover-card', () => ({
  HoverCard: ({
    children,
    onOpenChange
  }: {
    children: ReactNode
    onOpenChange?: (open: boolean) => void
  }) => {
    closeCard = () => onOpenChange?.(false)
    return createElement('span', { 'data-card': '' }, children)
  },
  HoverCardTrigger: ({
    render,
    children
  }: {
    render: React.ReactElement<{ children?: ReactNode }>
    children: ReactNode
  }) => createElement(render.type, render.props, children),
  HoverCardContent: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-card-content': '' }, children)
}))

import ReactMarkdown from 'react-markdown'

import {
  citationComponents,
  WebSearchRankMapContext
} from '@/components/markdown/markdown-citations'
import {
  rehypePluginsStable,
  remarkPluginsStable
} from '@/lib/markdown-plugins'

/** An answer's text drawn the way `Markdown` draws it, chips included. */
const answer = (text: string) =>
  createElement(
    ReactMarkdown,
    {
      remarkPlugins: remarkPluginsStable,
      rehypePlugins: rehypePluginsStable,
      components: citationComponents
    },
    text
  )

const source = (rank: number): WebSearchResult =>
  ({
    rank,
    link: `https://site${rank}.example/page`,
    title: `Title ${rank}`,
    content: '',
    snippet: '',
    siteName: `Site ${rank}`
  }) as WebSearchResult

const sources = new Map(
  [source(1), source(2), source(3)].map((s) => [s.rank, s])
)

function draw(text: string, map: Map<number, WebSearchResult> | null) {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(
    createElement(
      WebSearchRankMapContext.Provider,
      { value: map },
      answer(text)
    )
  )
  return host
}

describe('citations in an answer', () => {
  it('draws one chip for a place that cites two sources', () => {
    const host = draw('It rained【1,2-source】.', sources)
    const chips = host.querySelectorAll('a[aria-label]')

    expect(chips).toHaveLength(1)
    expect(chips[0].getAttribute('href')).toBe('https://site1.example/page')
    expect(chips[0].textContent).toBe('Site 1+1')
  })

  it('names every source of the chip to a screen reader', () => {
    const host = draw('It rained【1,2-source】.', sources)

    expect(
      host.querySelector('a[aria-label]')?.getAttribute('aria-label')
    ).toBe('Site 1, Site 2')
  })

  it('draws a single source without a count', () => {
    const host = draw('It rained【2-source】.', sources)

    expect(host.querySelector('a[aria-label]')?.textContent).toBe('Site 2')
  })

  it("holds the closing punctuation on the chip's line", () => {
    const host = draw('涨幅【1-source】。不过', sources)
    const held = host
      .querySelector('a[aria-label]')
      ?.closest('.whitespace-nowrap')

    expect(held).not.toBeNull()
    expect(held?.lastChild?.textContent).toBe('。')
  })

  // A marker is a citation wherever the model wrote it, not only in the
  // plain text of a paragraph: a summary of a fetched page cites from its
  // headings and its bold.
  it.each([
    ['bold', '**Revenue rose【1-source】**'],
    ['emphasis', '*Revenue rose【1-source】*'],
    ['struck text', '~~Revenue rose【1-source】~~'],
    ['a heading', '## Revenue rose【1-source】'],
    ['the text of a link', '[Revenue rose【1-source】](https://x.example)'],
    ['a list item', '- Revenue rose【1-source】'],
    ['a quote', '> Revenue rose【1-source】'],
    ['a table cell', '| A |\n| --- |\n| Revenue rose【1-source】 |']
  ])('draws a chip for a marker inside %s', (_where, text) => {
    const host = draw(text, sources)

    expect(host.querySelectorAll('a[aria-label="Site 1"]')).toHaveLength(1)
    expect(host.textContent).not.toContain('source】')
  })

  it('leaves a marker in code as it was typed', () => {
    expect(draw('`【1-source】`', sources).textContent).toContain(
      '【1-source】'
    )
    expect(draw('```\n【1-source】\n```', sources).textContent).toContain(
      '【1-source】'
    )
    expect(draw('`【1-source】`', sources).querySelectorAll('a')).toHaveLength(
      0
    )
  })

  it('draws nothing for a marker no source answers to, wherever it stands', () => {
    const host = draw('**Revenue rose【9-source】**.', sources)

    expect(host.textContent).toBe('Revenue rose.')
  })

  it('leaves no marker behind when there are no sources at all', () => {
    expect(draw('It rained 【1-source】.', null).textContent).toBe(
      'It rained .'
    )
  })
})

// Several sources behind one chip: the card shows one at a time, with a
// pager over it — a list of them grew with every source (owner, 2026-09-29).
describe('the card of a chip', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  async function open(text: string) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () =>
      root.render(
        createElement(
          WebSearchRankMapContext.Provider,
          { value: sources },
          answer(text)
        )
      )
    )
  }

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  const cardRoot = () => host.querySelector('[data-card-content]')
  /** What the card shows: the source that is not held out of sight. */
  const card = () =>
    cardRoot()?.querySelector('[data-source-card]:not([inert])') ?? null
  const button = (name: string) =>
    cardRoot()?.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
  const press = async (name: string) => {
    await act(async () => button(name)?.click())
  }

  it('shows one source and where it stands among them', async () => {
    await open('It rained【1,2,3-source】.')

    expect(card()?.textContent).toContain('Title 1')
    expect(card()?.textContent).not.toContain('Title 2')
    expect(cardRoot()?.textContent).toContain(
      'citation.position {"current":1,"total":3}'
    )
  })

  it('pages through them, and stops at either end', async () => {
    await open('It rained【1,2,3-source】.')

    expect(button('citation.previous')?.disabled).toBe(true)
    await press('citation.next')
    expect(card()?.textContent).toContain('Title 2')
    expect(cardRoot()?.textContent).toContain(
      'citation.position {"current":2,"total":3}'
    )
    await press('citation.next')
    expect(card()?.textContent).toContain('Title 3')
    expect(button('citation.next')?.disabled).toBe(true)
    await press('citation.previous')
    expect(card()?.textContent).toContain('Title 2')
  })

  it('opens the source it shows', async () => {
    await open('It rained【1,2-source】.')
    await press('citation.next')

    expect(card()?.getAttribute('href')).toBe('https://site2.example/page')
  })

  it('shows the icon of the source it shows', async () => {
    // The icon keeps what it loaded in state: a card that only swapped its
    // props showed the first site's icon beside the second site's name.
    await open('It rained【1,2-source】.')
    await press('citation.next')

    expect(card()?.querySelector('img')?.getAttribute('src')).toContain(
      'site2.example'
    )
  })

  it('keeps its size while paging: every source is laid out in one cell', async () => {
    // Paging to a shorter source used to shrink the card; the pager at its
    // top moved away from the pointer and the card closed under the click.
    await open('It rained【1,2,3-source】.')

    const cells = cardRoot()!.querySelectorAll('[data-source-card]')
    expect(cells).toHaveLength(3)
    expect([...cells].map((c) => c.hasAttribute('inert'))).toEqual([
      false,
      true,
      true
    ])
    await press('citation.next')
    expect(
      [...cardRoot()!.querySelectorAll('[data-source-card]')].map((c) =>
        c.hasAttribute('inert')
      )
    ).toEqual([true, false, true])
  })

  it('starts from the first source again once it has closed', async () => {
    await open('It rained【1,2-source】.')
    await press('citation.next')
    await act(async () => closeCard?.())

    expect(card()?.textContent).toContain('Title 1')
  })

  it('has no pager for a single source', async () => {
    await open('It rained【2-source】.')

    expect(cardRoot()?.querySelectorAll('button')).toHaveLength(0)
    expect(card()?.textContent).toContain('Title 2')
  })
})
