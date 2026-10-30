// src/main/lib/ai/philharmonic/pm-run-registry.ts
//
// Per-conversation PM runner. A Group has one active PM round; later triggers
// wait in FIFO order instead of concurrently changing the same plan. The
// active round alone owns an AbortController, so Stop remains precise.

const controllers = new Map<string, AbortController>()
const queues = new Map<string, Promise<void>>()

type Round = (signal: AbortSignal) => Promise<void>

function clearIfCurrent(conversationId: string, controller: AbortController) {
  if (controllers.get(conversationId) === controller) {
    controllers.delete(conversationId)
  }
}

export const pmRunRegistry = {
  set(conversationId: string, controller: AbortController): void {
    controllers.set(conversationId, controller)
  },

  /** Run one PM round after any earlier round for this Group completes. */
  run(conversationId: string, round: Round): Promise<void> {
    const previous = queues.get(conversationId) ?? Promise.resolve()
    const next = previous
      .catch(() => {
        // A failed predecessor must not strand later owner messages.
      })
      .then(async () => {
        const controller = new AbortController()
        controllers.set(conversationId, controller)
        try {
          await round(controller.signal)
        } finally {
          clearIfCurrent(conversationId, controller)
        }
      })
    queues.set(conversationId, next)
    void next.then(
      () => {
        if (queues.get(conversationId) === next) queues.delete(conversationId)
      },
      () => {
        if (queues.get(conversationId) === next) queues.delete(conversationId)
      }
    )
    return next
  },

  /** Remove the controller for this conversation, if any. Safe to call twice. */
  clear(conversationId: string): void {
    controllers.delete(conversationId)
  },

  has(conversationId: string): boolean {
    return controllers.has(conversationId)
  },

  /** Returns true if a controller was found and aborted, false otherwise. */
  abort(conversationId: string): boolean {
    const c = controllers.get(conversationId)
    if (!c) return false
    c.abort()
    return true
  }
}
