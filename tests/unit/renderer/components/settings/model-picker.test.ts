// @vitest-environment happy-dom
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type {
  SettingsInput,
  UseFormReturnType
} from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useForm } from 'react-hook-form'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const fetcherMock = vi.fn()
vi.mock('@actovia/shared/utils/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@actovia/shared/utils/http')>()),
  fetcher: (...args: unknown[]) => fetcherMock(...args)
}))
const sileoError = vi.fn()
vi.mock('sileo', () => ({
  sileo: { success: vi.fn(), error: (...a: unknown[]) => sileoError(...a) }
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false, t: (key: string) => key }
  })
}))

const { ModelPicker } =
  await import('@/components/settings/settings-form/providers/model-picker')
const { HttpError } = await import('@actovia/shared/utils/http')

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

function Harness({ apiKey }: { apiKey: string }) {
  const form = useForm<SettingsInput>({
    values: {
      providers: {
        openaiApiKey: apiKey,
        openaiBaseUrl: 'https://proxy.example/v1'
      }
    } as unknown as SettingsInput
  }) as UseFormReturnType
  return createElement(ModelPicker, {
    provider: AiProviders.OpenAiGpt,
    form,
    apiKeyField: 'providers.openaiApiKey',
    baseUrlField: 'providers.openaiBaseUrl'
  })
}

async function renderAndRefresh(apiKey = '•••• abcd') {
  await act(async () => {
    root.render(createElement(Harness, { apiKey }))
  })
  const button = host.querySelector<HTMLButtonElement>(
    `[data-testid="${TEST_IDS.providerModels.refreshButton}"]`
  )!
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

const inlineError = () =>
  host.querySelector(`[data-testid="${TEST_IDS.providerModels.reenterError}"]`)

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  fetcherMock.mockReset()
  sileoError.mockClear()
})

describe('ModelPicker: a saved key refused for a new base URL', () => {
  it('asks for the key inline, under the picker, and toasts nothing', async () => {
    fetcherMock.mockRejectedValue(
      new HttpError(
        400,
        'SECRET_REENTRY_REQUIRED',
        'The base URL differs from the saved one: re-enter the API key to use it with a new base URL',
        { field: 'apiKey' }
      )
    )
    await renderAndRefresh()
    expect(inlineError()?.textContent).toBe(
      'settings:providers.model.reenterKey'
    )
    expect(sileoError).not.toHaveBeenCalled()
  })

  it('any other failure is still a toast, with no inline error', async () => {
    fetcherMock.mockRejectedValue(
      new HttpError(502, 'SERVICE_OPENAI_FAILED', 'upstream down')
    )
    await renderAndRefresh()
    expect(inlineError()).toBeNull()
    expect(sileoError).toHaveBeenCalledTimes(1)
  })

  it('the inline error goes once the key is typed again', async () => {
    fetcherMock.mockRejectedValue(
      new HttpError(400, 'SECRET_REENTRY_REQUIRED', 're-enter', {
        field: 'apiKey'
      })
    )
    await renderAndRefresh()
    expect(inlineError()).not.toBeNull()
    await act(async () => {
      root.render(createElement(Harness, { apiKey: 'sk-typed-again' }))
    })
    expect(inlineError()).toBeNull()
  })
})
