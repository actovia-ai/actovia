import type { Settings } from '@actovia/shared/schemas/settings-schema'
import {
  fetcher,
  getHttpErrorMessage,
  toErrorI18n
} from '@actovia/shared/utils/http'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { refreshSecretsStatus } from '@/hooks/use-secrets-status'
import { updateSettings as updateSettingsService } from '@/services/settings'

export const settingsKeys = { all: ['settings'] as const }

export function useSettings() {
  const { t, i18n } = useTranslation(['errors', 'settings'])
  const queryClient = useQueryClient()
  const { data, error, isLoading } = useQuery({
    queryKey: settingsKeys.all,
    queryFn: () => fetcher<Settings>('/api/v1/settings')
  })

  /** Resolves `true` once the save landed, `false` when it failed (toasted). */
  const updateSettings = async (payload: Settings): Promise<boolean> => {
    try {
      await updateSettingsService(payload)
    } catch (err) {
      sileo.error({
        title: t('settings:toast.saveFailed'),
        description: getHttpErrorMessage(err, toErrorI18n(i18n))
      })
      return false
    }
    // Write the just-saved payload into the cache without refetching. A
    // revalidating GET (`invalidateQueries`) would bring back a freshly-bumped
    // `updatedAt`, which echoes through `useForm({ values: settings })` → RHF
    // resets the form → watch fires for the timestamp field → autosave fires
    // again → infinite POST/GET loop. Cancel a GET already in flight first:
    // setQueryData leaves it running, and it would land afterwards with the
    // pre-save object and overwrite what was just saved. Even this cache write
    // re-triggers RHF's `values` sync and the watch it fires; that loop is
    // closed on the other end, by `useSettingsAutosave`'s `isEqual(next,
    // get(persisted, name))` check (settings-autosave.ts) — the field's new
    // value already matches what was just cached, so nothing gets queued.
    await queryClient.cancelQueries({ queryKey: settingsKeys.all })
    queryClient.setQueryData(
      settingsKeys.all,
      (current: Settings | undefined) =>
        ({ ...current, ...payload }) as Settings
    )
    sileo.success({ title: t('settings:toast.autoSaved') })
    // A key typed again drops off the re-entry notice.
    void refreshSecretsStatus(queryClient)
    return true
  }

  return {
    data,
    isLoading,
    error,
    updateSettings
  }
}
