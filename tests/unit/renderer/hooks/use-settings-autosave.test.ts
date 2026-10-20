// @vitest-environment happy-dom
// S3 review M3: the two-flush interleave. Leaving the base-URL field for the
// key field flushes the URL on blur — with the key still its mask, so that
// save clears it — and the user is already typing the new key when that save
// lands in the cache. `useForm`'s `keepDirtyValues` is what keeps the typed
// key from being overwritten by the cleared one; the next flush then saves it
// against the new URL.
import type {
  Settings,
  SettingsInput,
  UseFormReturnType
} from '@actovia/shared/schemas/settings-schema'
import { act, createElement } from 'react'
import { useForm } from 'react-hook-form'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../helpers/query-test-utils'

const fetcherMock = vi.fn()
vi.mock('@actovia/shared/utils/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@actovia/shared/utils/http')>()),
  fetcher: (...args: unknown[]) => fetcherMock(...args)
}))
const updateSettingsService = vi.fn()
vi.mock('@/services/settings', () => ({
  updateSettings: (...args: unknown[]) => updateSettingsService(...args),
  getSecretsStatus: () =>
    Promise.resolve({ encryption: 'on', needsReentry: [] })
}))
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false }
  })
}))

const { useSettings } = await import('@/hooks/use-settings')
const { useSettingsAutosave } = await import('@/hooks/use-settings-autosave')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const persisted = {
  id: 'global',
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
  providers: { openaiApiKey: '•••• abcd', openaiBaseUrl: null }
} as unknown as Settings

let form: UseFormReturnType
let flushNow: () => void

// The Settings page's own wiring (settings-form.tsx).
function Page() {
  const { data } = useSettings()
  form = useForm<SettingsInput>({
    values: data as SettingsInput | undefined,
    resetOptions: { keepDirtyValues: true }
  }) as UseFormReturnType
  flushNow = useSettingsAutosave(form).flushNow
  return null
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
}

afterEach(() => {
  fetcherMock.mockReset()
  updateSettingsService.mockReset()
})

describe('useSettingsAutosave: URL, blur, then a new key', () => {
  it('the first flush clears the key; the key typed meanwhile survives and is the second flush', async () => {
    fetcherMock.mockResolvedValue(structuredClone(persisted))
    let landFirst!: () => void
    updateSettingsService
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            landFirst = resolve
          })
      )
      .mockResolvedValue()
    await renderWithQueryClient(createElement(Page))
    await settle()
    expect(form.getValues('providers.openaiApiKey')).toBe('•••• abcd')

    // Typed the new address, then clicked into the key field: blur flushes.
    act(() => {
      form.setValue('providers.openaiBaseUrl', 'https://proxy.example/v1', {
        shouldDirty: true
      })
    })
    act(() => flushNow())
    await settle()
    const first = updateSettingsService.mock.calls[0][0] as Settings
    expect(first.providers?.openaiBaseUrl).toBe('https://proxy.example/v1')
    expect(first.providers?.openaiApiKey).toBeNull()

    // The new key is typed before that save has landed.
    act(() => {
      form.setValue('providers.openaiApiKey', 'sk-typed-for-the-proxy', {
        shouldDirty: true
      })
    })
    await act(async () => {
      landFirst()
    })
    await settle()
    // The cache now says null; the typed key is kept (keepDirtyValues).
    expect(form.getValues('providers.openaiApiKey')).toBe(
      'sk-typed-for-the-proxy'
    )

    act(() => flushNow())
    await settle()
    expect(updateSettingsService).toHaveBeenCalledTimes(2)
    const second = updateSettingsService.mock.calls[1][0] as Settings
    expect(second.providers?.openaiApiKey).toBe('sk-typed-for-the-proxy')
    expect(second.providers?.openaiBaseUrl).toBe('https://proxy.example/v1')
  })
})
