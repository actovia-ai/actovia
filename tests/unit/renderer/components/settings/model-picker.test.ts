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
const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@/components/ui/toast', () => {
  // `toast.add({ type, ...options })` → the spy for that type.
  const byType: Record<string, (options: unknown) => void> = {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a)
  }
  return {
    toast: {
      add: ({ type, ...options }: { type: string }) => byType[type]?.(options)
    }
  }
})
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
  toastError.mockClear()
  toastSuccess.mockClear()
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
    expect(toastError).not.toHaveBeenCalled()
  })

  it('any other failure is still a toast, with no inline error', async () => {
    fetcherMock.mockRejectedValue(
      new HttpError(502, 'SERVICE_OPENAI_FAILED', 'upstream down')
    )
    await renderAndRefresh()
    expect(inlineError()).toBeNull()
    expect(toastError).toHaveBeenCalledTimes(1)
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

describe('ModelPicker: a refresh that succeeds (ISSUE-250)', () => {
  it('says so with a toast, and only then', async () => {
    fetcherMock.mockResolvedValue({
      models: [{ id: 'gpt-5', displayName: 'GPT-5' }]
    })
    await renderAndRefresh('sk-live')
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess.mock.calls[0][0]).toMatchObject({
      title: 'settings:providers.model.refreshedTitle',
      description: 'settings:providers.model.refreshedDescription'
    })
    expect(toastError).not.toHaveBeenCalled()
  })
})
