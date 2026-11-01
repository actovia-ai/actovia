import { useSyncExternalStore } from 'react'

export const REDUCE_MOTION_KEY = 'actovia-reduce-motion'
const CHANGE = 'actovia:motion-preference'
const QUERY = '(prefers-reduced-motion: reduce)'

/** App preference can reduce motion further; it never overrides OS accessibility. */
export function isMotionReduced(): boolean {
  return (
    document.documentElement.dataset.reduceMotion === 'true' ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia(QUERY).matches)
  )
}

export function applyReducedMotion(reduce: boolean): void {
  document.documentElement.dataset.reduceMotion = String(reduce)
  try {
    localStorage.setItem(REDUCE_MOTION_KEY, String(reduce))
  } catch {
    /* storage may be blocked */
  }
  window.dispatchEvent(new Event(CHANGE))
}

export function bootReducedMotion(): void {
  let reduce = false
  try {
    reduce = localStorage.getItem(REDUCE_MOTION_KEY) === 'true'
  } catch {
    /* system preference still applies */
  }
  document.documentElement.dataset.reduceMotion = String(reduce)
}

function subscribe(listener: () => void): () => void {
  const media =
    typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key === REDUCE_MOTION_KEY) {
      bootReducedMotion()
      listener()
    }
  }
  media?.addEventListener('change', listener)
  window.addEventListener(CHANGE, listener)
  window.addEventListener('storage', storage)
  return () => {
    media?.removeEventListener('change', listener)
    window.removeEventListener(CHANGE, listener)
    window.removeEventListener('storage', storage)
  }
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, isMotionReduced, () => false)
}
