// @vitest-environment happy-dom
// The chip in the header: which model answers, and a pick that saves it.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { Settings } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))

const navigate = vi.fn()
vi.mock('react-router', () => ({ useNavigate: () => navigate }))

let settings: Settings | undefined
vi.mock('@/hooks/use-settings', () => ({
  useSettings: () => ({ data: settings })
}))

let history: Array<Record<string, unknown>> = []
const setChatModel = vi.fn()
vi.mock('@/hooks/use-chat-history', () => ({
  useChatHistory: () => ({ data: history }),
  useSetChatModel: () => ({ mutate: setChatModel })
}))

// The popover's own behaviour is Base UI's; here it is always open.
const pass =
  (tag: string) =>
  ({ children, render, ...props }: Record<string, unknown>) =>
    render
      ? createElement(
          (render as { type: string | React.ComponentType }).type as string,
          {
            ...(render as { props: object }).props,
            ...Object.fromEntries(
              Object.entries(props).filter(
                ([k]) => k.startsWith('data-') || k === 'onClick'
              )
            )
          },
          children as ReactNode
        )
      : createElement(
          tag,
          Object.fromEntries(
            Object.entries(props).filter(
              ([key]) => key.startsWith('data-') || key === 'onClick'
            )
          ),
          children as ReactNode
        )
let initialFocus: { current: HTMLElement | null } | undefined
const content = pass('div')
vi.mock('@/components/ui/popover', () => ({
  Popover: pass('div'),
  PopoverTrigger: pass('button'),
  PopoverContent: (props: Record<string, unknown>) => {
    initialFocus = props.initialFocus as typeof initialFocus
    return content(props)
  }
}))

const { ModelChip } = await import('@/components/chat/header/model-chip')

const snapshot = { reasoningLevels: ['low', 'high'] }
const configured = (): Settings =>
  ({
    providerConfig: {
      provider: AiProviders.AnthropicClaude,
      model: 'claude-sonnet-5-5',
      modelSnapshot: snapshot
    },
    providers: { anthropicApiKey: '•••• abcd', openaiApiKey: '•••• wxyz' },
    modelCatalog: {
      [AiProviders.AnthropicClaude]: [
        { id: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', snapshot },
        {
          id: 'claude-opus-5-5',
          displayName: 'Claude Opus 5.5',
          snapshot: { reasoningLevels: ['max'] }
        }
      ],
      [AiProviders.OpenAiGpt]: [
        { id: 'gpt-5.6', displayName: 'GPT-5.6', snapshot }
      ]
    },
    keyboardShortcuts: { disabled: [] }
  }) as unknown as Settings

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  navigate.mockClear()
  setChatModel.mockClear()
  history = [{ id: 'c1', title: 'A chat', provider: null, model: null }]
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = () =>
  act(() => root.render(createElement(ModelChip, { chatId: 'c1' })))
const chip = () =>
  host.querySelector<HTMLElement>(
    `[data-testid="${TEST_IDS.chat.header.modelChip}"]`
  )
const options = () => [
  ...host.querySelectorAll<HTMLElement>(
    `[data-testid="${TEST_IDS.chat.header.modelOption}"]`
  )
]

describe('<ModelChip>', () => {
  it('a chat with no model of its own shows the default, checked in a list of every provider with a key', () => {
    settings = configured()
    render()
    expect(chip()?.textContent).toBe('Claude Sonnet 5.5')
    expect(
      options().map(
        (o) => `${o.dataset.model}:${o.getAttribute('aria-checked')}`
      )
    ).toEqual([
      'gpt-5.6:false',
      'claude-sonnet-5-5:true',
      'claude-opus-5-5:false'
    ])
  })

  it("shows the chat's own model, of another provider than the default", () => {
    settings = configured()
    history = [{ id: 'c1', provider: AiProviders.OpenAiGpt, model: 'gpt-5.6' }]
    render()
    expect(chip()?.textContent).toBe('GPT-5.6')
    expect(
      options().find((o) => o.getAttribute('aria-checked') === 'true')?.dataset
        .model
    ).toBe('gpt-5.6')
  })

  it('opens on the checked model, centred in the list, not on the first provider', () => {
    settings = configured()
    // happy-dom lays nothing out: the checked row 300px down a 320px list.
    const proto = HTMLElement.prototype
    const saved = ['offsetTop', 'offsetHeight', 'clientHeight'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const
    )
    Object.defineProperties(proto, {
      offsetTop: {
        configurable: true,
        get(this: HTMLElement) {
          return this.dataset.model === 'claude-sonnet-5-5' ? 300 : 0
        }
      },
      offsetHeight: { configurable: true, get: () => 32 },
      clientHeight: { configurable: true, get: () => 320 }
    })
    try {
      render()
      expect(host.querySelector<HTMLElement>('[role="menu"]')?.scrollTop).toBe(
        300 - (320 - 32) / 2
      )
    } finally {
      for (const [key, descriptor] of saved)
        if (descriptor) Object.defineProperty(proto, key, descriptor)
        else delete (proto as unknown as Record<string, unknown>)[key]
    }
  })

  it('the popup focuses the checked row as it opens, not the first row', () => {
    // Base UI's default focus went to the first row, and focusing it scrolled
    // the list back to the top right after it had been centred.
    settings = configured()
    render()
    expect(initialFocus?.current?.dataset.model).toBe('claude-sonnet-5-5')
  })

  it('a pick is saved on the chat, never on the settings', async () => {
    settings = configured()
    render()
    await act(async () => options()[0].click())
    expect(setChatModel).toHaveBeenCalledWith({
      id: 'c1',
      provider: AiProviders.OpenAiGpt,
      model: 'gpt-5.6'
    })
  })

  it('picking the current model saves nothing', async () => {
    settings = configured()
    render()
    await act(async () => options()[1].click())
    expect(setChatModel).not.toHaveBeenCalled()
  })

  it('a stale model id, no longer in the catalog, is shown as it is', () => {
    settings = configured()
    history = [
      { id: 'c1', provider: AiProviders.AnthropicClaude, model: 'claude-old' }
    ]
    render()
    expect(chip()?.textContent).toBe('claude-old')
  })

  it("without a key for the chat's provider, the chip asks for one and opens Settings › AI Providers", () => {
    settings = configured()
    settings.providers = { anthropicApiKey: '' } as Settings['providers']
    render()
    expect(chip()?.textContent).toBe('header.noModel')
    act(() => chip()!.click())
    expect(navigate).toHaveBeenCalledWith('/settings?tab=ai-providers')

    settings = undefined
    render()
    expect(chip()?.textContent).toBe('header.noModel')
  })

  it('says the pick is for this chat only, and offers the default in Settings', () => {
    settings = configured()
    settings.modelCatalog = null
    render()
    expect(chip()?.textContent).toBe('claude-sonnet-5-5')
    expect(options()).toEqual([])
    expect(host.textContent).toContain('header.noModels')
    expect(host.textContent).toContain('header.modelScope')
    const link = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'header.openProviders'
    )
    act(() => link!.click())
    expect(navigate).toHaveBeenCalledWith('/settings?tab=ai-providers')
  })
})
