// @vitest-environment happy-dom
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type {
  SettingsInput,
  UseFormReturnType
} from '@actovia/shared/schemas/settings-schema'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useForm } from 'react-hook-form'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const status = vi.hoisted(() => ({
  value: { encryption: 'on', needsReentry: [] as string[] }
}))
vi.mock('@/services/settings', () => ({
  getSecretsStatus: () => Promise.resolve(status.value),
  updateSettings: vi.fn()
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}${JSON.stringify(params)}` : key
  })
}))

const { ProviderFields } =
  await import('@/components/settings/settings-form/providers/provider-fields')
const { clearedSecretsAtom } = await import('@/stores/secrets')

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let store: ReturnType<typeof createStore>
let form: UseFormReturnType

const OPENAI_FIELDS = [
  {
    name: 'providers.openaiApiKey' as const,
    label: 'key',
    description: '',
    type: 'password' as const
  },
  {
    name: 'providers.openaiBaseUrl' as const,
    label: 'url',
    description: ''
  }
]

function Harness({ values }: { values: SettingsInput }) {
  form = useForm<SettingsInput>({ values }) as UseFormReturnType
  return createElement(ProviderFields, { form, fields: OPENAI_FIELDS })
}

async function render(providers: Record<string, string | null>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  await act(async () => {
    root.render(
      createElement(
        JotaiProvider,
        { store },
        createElement(
          QueryClientProvider,
          { client },
          createElement(Harness, {
            values: { providers } as unknown as SettingsInput
          })
        )
      )
    )
  })
  // Let the secrets-status read land.
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
}

const byTestId = (id: string) =>
  host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)
const keyInput = () =>
  host.querySelector<HTMLInputElement>(
    `[data-testid="${TEST_IDS.secrets.keyInput}"][data-field="providers.openaiApiKey"]`
  )!
// The second field: the base URL.
const urlInput = () => host.querySelectorAll<HTMLInputElement>('input')[1]

function type(el: HTMLInputElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  store = createStore()
  status.value = { encryption: 'on', needsReentry: [] }
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('SecretInput: a saved key', () => {
  it('shows the mask as text (never as password dots) and says it is saved', async () => {
    await render({ openaiApiKey: '•••• abcd', openaiBaseUrl: null })
    const input = keyInput()
    expect(input.value).toBe('•••• abcd')
    expect(input.type).toBe('text')
    expect(input.dataset.masked).toBe('true')
    expect(host.textContent).toContain('secrets.input.saved')
  })

  it('typing replaces the mask with what was typed', async () => {
    await render({ openaiApiKey: '•••• abcd', openaiBaseUrl: null })
    type(keyInput(), '•••• abcds')
    expect(form.getValues('providers.openaiApiKey')).toBe('s')
    expect(keyInput().type).toBe('password')
    expect(keyInput().dataset.masked).toBeUndefined()
  })

  it('deleting from the mask clears the key', async () => {
    await render({ openaiApiKey: '•••• abcd', openaiBaseUrl: null })
    type(keyInput(), '•••• abc')
    expect(form.getValues('providers.openaiApiKey')).toBe('')
  })

  it('a key typed from scratch stays a password field with the text as typed', async () => {
    await render({ openaiApiKey: null, openaiBaseUrl: null })
    expect(keyInput().type).toBe('password')
    type(keyInput(), 'sk-new')
    expect(form.getValues('providers.openaiApiKey')).toBe('sk-new')
  })

  it('asks for the key again when a save cleared it, until one is typed', async () => {
    store.set(clearedSecretsAtom, ['providers.openaiApiKey'])
    await render({ openaiApiKey: null, openaiBaseUrl: 'https://proxy.example' })
    expect(byTestId(TEST_IDS.secrets.reenterPrompt)).toHaveLength(1)
    type(keyInput(), 'sk-new')
    expect(byTestId(TEST_IDS.secrets.reenterPrompt)).toHaveLength(0)
    expect(store.get(clearedSecretsAtom)).toEqual([])
  })

  it('asks for a key the status reports as unreadable', async () => {
    status.value = {
      encryption: 'on',
      needsReentry: ['providers.openaiApiKey']
    }
    await render({ openaiApiKey: null, openaiBaseUrl: null })
    expect(byTestId(TEST_IDS.secrets.reenterPrompt)).toHaveLength(1)
  })
})

describe('SecretInput: what a screen reader hears', () => {
  const describedBy = () =>
    document.getElementById(keyInput().getAttribute('aria-describedby') ?? '')
      ?.textContent

  it('a saved key is named by its last four, not read out as bullets', async () => {
    await render({ openaiApiKey: '•••• abcd', openaiBaseUrl: null })
    const expected = 'secrets.input.savedAria{"last4":"abcd"}'
    expect(keyInput().getAttribute('aria-label')).toBe(expected)
    expect(describedBy()).toBe(expected)
  })

  it('a short saved key (no tail) is "a saved key"', async () => {
    await render({ openaiApiKey: '••••', openaiBaseUrl: null })
    expect(keyInput().getAttribute('aria-label')).toBe(
      'secrets.input.savedShortAria'
    )
  })

  it('an empty field says no key is saved; a typed key says nothing extra', async () => {
    await render({ openaiApiKey: null, openaiBaseUrl: null })
    expect(describedBy()).toBe('secrets.input.noneAria')
    expect(keyInput().getAttribute('aria-label')).toBeNull()
    type(keyInput(), 'sk-new')
    expect(keyInput().getAttribute('aria-describedby')).toBeNull()
  })
})

describe('the base-URL hint', () => {
  it('appears when the address field is focused while the key is a mask', async () => {
    await render({ openaiApiKey: '•••• abcd', openaiBaseUrl: null })
    expect(byTestId(TEST_IDS.secrets.destinationHint)).toHaveLength(0)
    act(() => urlInput().focus())
    const hint = byTestId(TEST_IDS.secrets.destinationHint)
    expect(hint).toHaveLength(1)
    expect(hint[0].textContent).toBe('secrets.destinationHint')
  })

  it('stays while an edit is unsaved, even after focus leaves', async () => {
    await render({ openaiApiKey: '•••• abcd', openaiBaseUrl: null })
    act(() => urlInput().focus())
    type(urlInput(), 'https://proxy.example/v1')
    act(() => urlInput().blur())
    expect(byTestId(TEST_IDS.secrets.destinationHint)).toHaveLength(1)
  })

  it('is not shown when there is no saved key to lose', async () => {
    await render({ openaiApiKey: null, openaiBaseUrl: null })
    act(() => urlInput().focus())
    expect(byTestId(TEST_IDS.secrets.destinationHint)).toHaveLength(0)
  })
})

describe('the base-URL hint, for a screen reader (S3 minor)', () => {
  it('describes the field whenever a key is saved — before focus, and after', async () => {
    await render({ openaiApiKey: '•••• abcd', openaiBaseUrl: null })
    const describedBy = urlInput().getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(host.querySelector(`[id="${describedBy}"]`)?.textContent).toBe(
      'secrets.destinationHint'
    )
    act(() => urlInput().focus())
    const id = urlInput().getAttribute('aria-describedby')
    expect(host.querySelector(`[id="${id}"]`)?.textContent).toBe(
      'secrets.destinationHint'
    )
  })

  it('describes nothing when there is no saved key to lose', async () => {
    await render({ openaiApiKey: null, openaiBaseUrl: null })
    expect(urlInput().getAttribute('aria-describedby')).toBeNull()
  })
})

describe('SettingsRow: the layout does not move as a key is typed', () => {
  // The description's spacing is positional (shadcn's `nth-last-2:-mt-1`),
  // so the row's children must not change in number when the control's own
  // pieces come and go — a pasted key dropped the "no key saved" sr-only
  // label and the description jumped (ISSUE-109).
  const descriptionOf = () =>
    host.querySelector<HTMLElement>('[data-slot="field-description"]')!
  const positionFromEnd = (el: HTMLElement) => {
    const siblings = [...el.parentElement!.children]
    return siblings.length - siblings.indexOf(el)
  }

  it('keeps the description in the same place from empty to typed to saved', async () => {
    OPENAI_FIELDS[0].description = 'desc'
    try {
      await render({ openaiApiKey: null, openaiBaseUrl: null })
      const empty = positionFromEnd(descriptionOf())
      type(keyInput(), 'sk-pasted')
      expect(positionFromEnd(descriptionOf())).toBe(empty)
      await render({ openaiApiKey: '•••• abcd', openaiBaseUrl: null })
      expect(positionFromEnd(descriptionOf())).toBe(empty)
    } finally {
      OPENAI_FIELDS[0].description = ''
    }
  })
})
