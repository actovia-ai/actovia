import { isMotionReduced } from '@/lib/reduced-motion'
/** Where a jumped-to question lands, measured from the transcript's top. */
export const SCROLL_OFFSET = 88

/**
 * The transcript's scroll container carries `data-chat-scroll` (`messages.tsx`),
 * so the header's panel can find it from outside.
 */
const CONTAINER = '[data-chat-scroll]'

/**
 * Scrolls `container` so the run's question (`data-user-msg-id`, the run's
 * user message id) sits `SCROLL_OFFSET` under its top. False when the run is
 * not on screen — an older page not loaded yet.
 */
export function scrollRunIntoView(
  container: HTMLElement,
  runId: string
): boolean {
  const node = container.querySelector<HTMLElement>(
    `[data-user-msg-id="${CSS.escape(runId)}"]`
  )
  if (!node) return false
  const delta =
    node.getBoundingClientRect().top -
    container.getBoundingClientRect().top -
    SCROLL_OFFSET
  container.scrollBy({
    top: delta,
    behavior: isMotionReduced() ? 'instant' : 'smooth'
  })
  return true
}

/** From outside the transcript (the header's panel): the open chat's. */
export function scrollToRun(runId: string): boolean {
  const container = document.querySelector<HTMLElement>(CONTAINER)
  return !!container && scrollRunIntoView(container, runId)
}
