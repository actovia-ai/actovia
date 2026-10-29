import type { CSSProperties } from 'react'

export const HUE_NAMES = [
  'lilac',
  'mint',
  'peach',
  'sky',
  'rose',
  'honey',
  'periwinkle',
  'sage'
] as const

export type HueName = (typeof HUE_NAMES)[number]

function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function pickHue(seed: string | null | undefined): HueName {
  const key = seed && seed.length > 0 ? seed : 'default'
  return HUE_NAMES[hash(key) % HUE_NAMES.length]
}

/**
 * A pastel disc behind an avatar: the hue's fill under a hairline of the
 * foreground, not a ring of the hue (ISSUE-294: the coloured 1.5px ring read
 * heavy beside the sidebar's quiet rows).
 */
export function hueStyle(hue: HueName): CSSProperties {
  return {
    background: `var(--ph-hue-${hue}-fill)`,
    boxShadow:
      'inset 0 0 0 1px color-mix(in oklab, var(--foreground) 6%, transparent)'
  }
}

export function hueFill(hue: HueName): string {
  return `var(--ph-hue-${hue}-fill)`
}

export function hueRing(hue: HueName): string {
  return `var(--ph-hue-${hue}-ring)`
}
