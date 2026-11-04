/** Shared across Groups; every runtime enters before it starts work. */
let active = 0
const waiting: Array<{
  limit: number
  signal?: AbortSignal
  start(): void
  cancel(): void
}> = []
function wake() {
  while (waiting.length > 0 && active < waiting[0].limit) {
    waiting.shift()!.start()
  }
}
export async function acquireStaffSlot(
  limit: number,
  signal?: AbortSignal
): Promise<() => void> {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const entry = {
      limit: Math.max(1, limit),
      signal,
      start() {
        signal?.removeEventListener('abort', entry.cancel)
        active++
        resolve()
      },
      cancel() {
        const i = waiting.indexOf(entry)
        if (i >= 0) waiting.splice(i, 1)
        reject(signal?.reason ?? new Error('Aborted'))
        wake()
      }
    }
    signal?.addEventListener('abort', entry.cancel, { once: true })
    waiting.push(entry)
    wake()
  })
  let released = false
  return () => {
    if (released) return
    released = true
    active--
    wake()
  }
}
