import {
  WEB_CLIENT_HEADER,
  WEB_SESSION_EVENT,
  type WebTerminalStatus
} from '@actovia/shared/types/web-terminal'

export async function webTerminalRequest<T>(
  path = '',
  body?: unknown
): Promise<T> {
  const response = await fetch(`/api/web-terminal${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json', [WEB_CLIENT_HEADER]: '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  if (!response.ok) throw new Error('Web terminal request failed.')
  return response.json() as Promise<T>
}

export const getWebTerminalStatus = () =>
  webTerminalRequest<WebTerminalStatus>()
export async function lockWebTerminal() {
  await webTerminalRequest('/lock', {})
  window.dispatchEvent(new Event(WEB_SESSION_EVENT))
}
export async function forgetWebTerminal() {
  await webTerminalRequest('/forget', {})
  window.dispatchEvent(new Event(WEB_SESSION_EVENT))
}
