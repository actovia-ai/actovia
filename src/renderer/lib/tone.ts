import {
  ColorToneSchema,
  type ColorTone
} from '@actovia/shared/schemas/settings-schema'

/** localStorage mirror of `settings.colorTone`, so the tone paints before React. */
export const COLOR_TONE_STORAGE_KEY = 'actovia-color-tone'
export const DEFAULT_COLOR_TONE: ColorTone = 'neutral'

/** Set `data-tone` on <html> (what globals.css keys its palettes on) + cache it. */
export function applyTone(tone: ColorTone): void {
  document.documentElement.dataset.tone = tone
  try {
    window.localStorage.setItem(COLOR_TONE_STORAGE_KEY, tone)
  } catch {
    // Blocked storage: the attribute is applied regardless.
  }
}

/** Synchronous first paint from the cache. Call before createRoot. */
export function bootTone(): void {
  let cached: string | null = null
  try {
    cached = window.localStorage.getItem(COLOR_TONE_STORAGE_KEY)
  } catch {
    cached = null
  }
  const parsed = ColorToneSchema.safeParse(cached)
  document.documentElement.dataset.tone = parsed.success
    ? parsed.data
    : DEFAULT_COLOR_TONE
}

/** Sub-apps share the main window's localStorage: follow its tone changes. */
export function subscribeToneCache(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === COLOR_TONE_STORAGE_KEY) cb()
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
