/**
 * The artifact's height, for an embedder that sizes its frame to it: actovia-ios
 * shows the artifact inline in a chat, as tall as it draws (up to a limit).
 * `{ type: 'artifact-sandbox-size', height }`, in whole CSS pixels, goes to the
 * parent after each render and whenever the content's height changes. The
 * desktop's card has a fixed height and ignores it.
 */
export const SIZE_MESSAGE_TYPE = 'artifact-sandbox-size'

export interface SizeMessage {
  type: typeof SIZE_MESSAGE_TYPE
  height: number
}

export function sizeMessage(height: number): SizeMessage | null {
  if (!Number.isFinite(height) || height < 0) return null
  return { type: SIZE_MESSAGE_TYPE, height: Math.ceil(height) }
}

/**
 * The root's own height, with what overflows it: a child's margin can stick
 * out of its box, and its scroll height catches that.
 */
export function measure(element: Element): number {
  return Math.max(element.getBoundingClientRect().height, element.scrollHeight)
}

/**
 * Watches `element` and posts its height when it changes; `report()` posts it
 * even when it has not (after a render, so a new embedder hears it once).
 */
export function observeSize(
  element: Element,
  post: (message: SizeMessage) => void,
  Observer: typeof ResizeObserver | null = globalThis.ResizeObserver ?? null
) {
  let last: number | null = null
  const send = (force: boolean) => {
    const message = sizeMessage(measure(element))
    if (!message || (!force && message.height === last)) return
    last = message.height
    post(message)
  }
  const observer = Observer ? new Observer(() => send(false)) : null
  observer?.observe(element)
  return {
    report: () => send(true),
    disconnect: () => observer?.disconnect()
  }
}
