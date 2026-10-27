import { type RefObject, useEffect, useState } from 'react'

/**
 * Whether `ref`'s element is on screen or within `rootMargin` of it, kept
 * current as it scrolls. True from the start where there is no
 * IntersectionObserver (nothing to wait for).
 */
export function useInView(
  ref: RefObject<Element | null>,
  rootMargin = '0px'
): boolean {
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === 'undefined'
  )
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { rootMargin }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, rootMargin])
  return inView
}
