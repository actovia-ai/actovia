// @vitest-environment happy-dom
// Copy hands out the answer with its references, not with the markers the
// model wrote for the chips.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }))
// Read-aloud is its own business, and asks the API.
vi.mock('@/components/chat/audio-player', () => ({ default: () => null }))

const { MessageAction } = await import('@/components/chat/message-action')

const sources = [
  {
    rank: 4,
    title: 'Microsoft jumps',
    link: 'https://finance.yahoo.com/a',
    content: '',
    snippet: ''
  }
] as WebSearchResult[]

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue()
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

async function copy(props: {
  content: string
  citationSources?: WebSearchResult[]
}) {
  await act(async () => root.render(createElement(MessageAction, props)))
  const bar = host.querySelector(
    `[data-testid="${TEST_IDS.chat.messageAction}"]`
  )
  // The tooltip's trigger is a button around the bar's own.
  const button = bar?.querySelector<HTMLElement>('button button')
  await act(async () => button?.click())
}

describe('MessageAction — Copy', () => {
  it('copies citations as numbers, with the sources listed under the answer', async () => {
    await copy({ content: 'Up 3.66%【4-source】.', citationSources: sources })

    expect(writeText).toHaveBeenCalledWith(
      'Up 3.66%[1].\n\n---\n\n## deepResearchCard.referencesHeading\n\n' +
        '- [1] Microsoft jumps (finance.yahoo.com) https://finance.yahoo.com/a'
    )
  })

  it('copies an answer without citations as it is', async () => {
    await copy({ content: 'Plain **answer**.' })

    expect(writeText).toHaveBeenCalledWith('Plain **answer**.')
  })
})
