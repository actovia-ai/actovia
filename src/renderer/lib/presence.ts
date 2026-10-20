/**
 * The user-presence token (`src/main/lib/presence.ts`): what tells the API a
 * request comes from this window, not from any process on the machine — the
 * approval answer and the Devices page need it. Asked of the main process
 * once over IPC and kept in memory only (never storage: anything on disk a
 * local process could read).
 */
const PRESENCE_CHANNEL = 'api:presence-token'
const PRESENCE_HEADER = 'x-actovia-presence'

let pending: Promise<string | null> | null = null

function token(): Promise<string | null> {
  pending ??= Promise.resolve(
    window.electron?.ipcRenderer.invoke(PRESENCE_CHANNEL) as
      | Promise<string | null>
      | undefined
  )
    .then((value) => (typeof value === 'string' && value ? value : null))
    .catch(() => null)
    .then((value) => {
      // A refusal is not cached: the next call asks again.
      if (value === null) pending = null
      return value
    })
  return pending
}

/** The header to send, or none when this window was not given the token. */
export async function presenceHeaders(): Promise<Record<string, string>> {
  const value = await token()
  return value ? { [PRESENCE_HEADER]: value } : {}
}
