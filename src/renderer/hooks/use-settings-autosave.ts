import type { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { useSetAtom } from 'jotai'
import { get, isEqual, union } from 'lodash-es'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { useSettings } from '@/hooks/use-settings'
import { buildSettingsSave } from '@/lib/settings-autosave'
import { clearedSecretsAtom } from '@/stores/secrets'

// A text edit coalesces on a longer idle window (it also flushes on blur, see
// `flushNow`), so typing never fires a save mid-word. A Switch/Select/radio has
// no "blur" to wait for, so its change settles almost immediately.
const TEXT_ENTRY_DEBOUNCE_MS = 1200
const CONTROL_DEBOUNCE_MS = 200

function isTextEntryActive(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.activeElement
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  )
}

/**
 * Per-field autosave for the Settings form.
 *
 * Replaces the old whole-form `form.handleSubmit(persist)` autosave, whose Zod
 * gate meant a single invalid field *anywhere* (a half-typed URL on another
 * tab, an out-of-range number) silently blocked every save with no feedback.
 *
 * Here each changed field is merged onto the last **persisted** settings and
 * saved on its own; an unrelated bad field can't block it, and an invalid value
 * in the field you're editing surfaces a toast instead of failing silently.
 *
 * Returns `flushNow` for the form's `onBlur` handler so text fields save the
 * moment focus leaves them.
 */
export function useSettingsAutosave(form: UseFormReturnType) {
  const { t } = useTranslation('settings')
  const { data: settings, updateSettings } = useSettings()
  const setClearedSecrets = useSetAtom(clearedSecretsAtom)

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const updateRef = useRef(updateSettings)
  updateRef.current = updateSettings

  // path → latest raw value, accumulated across the debounce window so a burst
  // of edits (or a blur mid-burst) saves as one payload with nothing dropped.
  const pendingRef = useRef(new Map<string, unknown>())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushRef = useRef(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const persisted = settingsRef.current
    const changes = pendingRef.current
    if (!persisted || changes.size === 0) return
    pendingRef.current = new Map()

    const result = buildSettingsSave(persisted, changes)
    if (result.status === 'noop') return
    if (result.status === 'invalid') {
      sileo.error({ title: t('toast.notSaved'), description: result.errors[0] })
      return
    }
    const saved = await updateRef.current(result.payload)
    if (saved && result.clearedSecrets.length > 0) {
      setClearedSecrets((prev) => union(prev, result.clearedSecrets))
    }
  })

  useEffect(() => {
    const subscription = form.watch((values, { name }) => {
      // RHF fires with `name` undefined on mount hydration and on `reset()`
      // (which the post-save settings refetch triggers) — never a user edit.
      if (!name) return
      const persisted = settingsRef.current
      if (!persisted) return

      const next = get(values, name)
      if (isEqual(next, get(persisted, name))) {
        // Reverted to the saved value before it flushed — drop it.
        pendingRef.current.delete(name)
        return
      }
      pendingRef.current.set(name, next)

      if (timerRef.current) clearTimeout(timerRef.current)
      const delay = isTextEntryActive()
        ? TEXT_ENTRY_DEBOUNCE_MS
        : CONTROL_DEBOUNCE_MS
      timerRef.current = setTimeout(() => void flushRef.current(), delay)
    })

    return () => {
      subscription.unsubscribe()
      // Navigating away from /settings: persist the last edit rather than drop it.
      void flushRef.current()
    }
  }, [form])

  return { flushNow: () => void flushRef.current() }
}
