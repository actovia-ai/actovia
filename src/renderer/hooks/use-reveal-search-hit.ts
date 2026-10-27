import { type RefObject, useContext, useEffect } from 'react'
import { UNSAFE_LocationContext } from 'react-router'

import {
  findWordRanges,
  isSearchReveal,
  markRanges,
  revealTarget,
  runElement,
  scrollToReveal
} from '@/lib/reveal-search-hit'

/** How long the run may take to appear (a page of older history loading). */
const WAIT_MS = 4000
/** A second look once late layout (images, code blocks, fonts) has settled. */
const SETTLE_MS = 450

/**
 * The transcript's side of opening a chat at a search hit (see
 * `lib/reveal-search-hit.ts`). The traps, most of them hikki's first:
 *
 * - the transcript scrolls itself to the bottom on mount, so the reveal
 *   waits two frames for that to have happened, never races it;
 * - the run may be on a page not loaded: history is loaded back through it
 *   (`loadThrough`), once, and the run awaited;
 * - what is above the hit keeps growing after the first paint (a picture,
 *   a highlighted code block), which pushes the word off where it was put:
 *   one more look after it settles, unless the reader has scrolled since;
 * - the state is read per navigation (`location.key`), so the same chat
 *   searched again from the open chat reveals again.
 */
export function useRevealSearchHit(
  containerRef: RefObject<HTMLElement | null>,
  loadThrough: (runId: string) => Promise<void>
): void {
  // The location's context, not `useLocation()`: the transcript is also
  // drawn outside a router (its render tests), where there is nothing to
  // reveal and `useLocation()` would throw.
  const location = useContext(UNSAFE_LocationContext)?.location
  const reveal = isSearchReveal(location?.state) ? location?.state : null

  useEffect(() => {
    if (!reveal) return
    let cancelled = false
    let raf = 0
    let settle = 0
    let askedOlder = false
    let userScrolled = false
    const started = performance.now()
    const container = containerRef.current
    const onUserScroll = () => (userScrolled = true)
    container?.addEventListener('wheel', onUserScroll, { passive: true })
    container?.addEventListener('keydown', onUserScroll)

    const show = () => {
      const box = containerRef.current
      const el = box && runElement(box, reveal.runId, reveal.role)
      if (!box || !el) return false
      const ranges = findWordRanges(el, reveal.words)
      markRanges(ranges)
      scrollToReveal(box, ranges, revealTarget(el, reveal.toolCallId))
      return true
    }

    const look = () => {
      if (cancelled) return
      const box = containerRef.current
      if (box && runElement(box, reveal.runId, reveal.role)) {
        // Two frames: the mount's scroll to the bottom has run by then.
        raf = requestAnimationFrame(() => {
          raf = requestAnimationFrame(() => {
            if (cancelled || !show()) return
            settle = window.setTimeout(() => {
              if (!cancelled && !userScrolled) show()
            }, SETTLE_MS)
          })
        })
        return
      }
      if (!askedOlder) {
        askedOlder = true
        void loadThrough(reveal.runId).catch(() => undefined)
      }
      if (performance.now() - started < WAIT_MS)
        raf = requestAnimationFrame(look)
    }
    look()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.clearTimeout(settle)
      container?.removeEventListener('wheel', onUserScroll)
      container?.removeEventListener('keydown', onUserScroll)
      markRanges([])
    }
    // One reveal per navigation: `location.key` names it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.key])
}
