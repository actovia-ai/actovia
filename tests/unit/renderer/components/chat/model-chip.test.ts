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
const updateSettings = vi.fn(async () => true)
vi.mock('@/hooks/use-settings', () => ({
  useSettings: () => ({ data: settings, updateSettings })
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
vi.mock('@/components/ui/popover', () => ({
  Popover: pass('div'),
  PopoverTrigger: pass('button'),
  PopoverContent: pass('div')
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
    providers: { anthropicApiKey: '•••• abcd' },
    modelCatalog: {
      [AiProviders.AnthropicClaude]: [
        { id: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', snapshot },
        {
          id: 'claude-opus-5-5',
          displayName: 'Claude Opus 5.5',
          snapshot: { reasoningLevels: ['max'] }
        }
      ]
    },
    keyboardShortcuts: { disabled: [] }
  }) as unknown as Settings

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  navigate.mockClear()
  updateSettings.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = () => act(() => root.render(createElement(ModelChip)))
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
  it("reads the provider and the model's display name, and checks the current one in its list", () => {
    settings = configured()
    render()
    expect(chip()?.textContent).toBe('Claude · Claude Sonnet 5.5')
    expect(
      options().map(
        (o) => `${o.dataset.model}:${o.getAttribute('aria-checked')}`
      )
    ).toEqual(['claude-sonnet-5-5:true', 'claude-opus-5-5:false'])
  })

  it('a pick saves the model and its snapshot, the rest of the settings untouched', async () => {
    settings = configured()
    render()
    await act(async () => options()[1].click())
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({
      ...settings,
      providerConfig: {
        provider: AiProviders.AnthropicClaude,
        model: 'claude-opus-5-5',
        modelSnapshot: { reasoningLevels: ['max'] }
      }
    })
  })

  it('picking the current model saves nothing', async () => {
    settings = configured()
    render()
    await act(async () => options()[0].click())
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('a stale model id, no longer in the catalog, is shown as it is', () => {
    settings = configured()
    settings.providerConfig!.model = 'claude-old'
    render()
    expect(chip()?.textContent).toBe('Claude · claude-old')
  })

  it('without a key, or without a model, the chip asks for one and opens Settings › AI Providers', () => {
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

  it('an empty catalog says so and offers Settings', () => {
    settings = configured()
    settings.modelCatalog = null
    render()
    expect(chip()?.textContent).toBe('Claude · claude-sonnet-5-5')
    expect(options()).toEqual([])
    expect(host.textContent).toContain('header.noModels')
    const link = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'header.openProviders'
    )
    act(() => link!.click())
    expect(navigate).toHaveBeenCalledWith('/settings?tab=ai-providers')
  })
})
