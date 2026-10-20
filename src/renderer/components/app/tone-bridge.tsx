import { ColorToneSchema } from '@actovia/shared/schemas/settings-schema'
import { useEffect } from 'react'

import { useSettings } from '@/hooks/use-settings'
import { DEFAULT_COLOR_TONE, applyTone } from '@/lib/tone'

/**
 * Follows `settings.colorTone` and keeps `<html data-tone>` + the boot cache
 * in sync. Side-effect only — mirrors `NativeThemeBridge` / `LocaleBridge`.
 * `bootTone()` already applied the cached value before React mounted.
 */
export function ToneBridge() {
  const { data } = useSettings()
  const raw = data?.colorTone
  const loaded = data !== undefined

  useEffect(() => {
    if (!loaded) return
    applyTone(ColorToneSchema.catch(DEFAULT_COLOR_TONE).parse(raw))
  }, [raw, loaded])

  return null
}
