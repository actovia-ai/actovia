/** Shared device lifecycle; a Web terminal is a separate paired device. */
const listeners = new Set<(id?: string) => void>()

export function onDeviceRevoked(listener: (id?: string) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function deviceRevoked(id?: string) {
  for (const listener of listeners) listener(id)
}
