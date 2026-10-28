import {
  fetchPinned as fetchPinnedWith,
  type PinnedFetchOptions as BaseOptions
} from '@actovia-ai/web-reader'

import { assertAddressesNotActoviaApi } from './local-api-guard'

export type PinnedFetchOptions = Omit<
  BaseOptions,
  'checkAddresses' | 'userAgent'
>

/**
 * One GET of a model-chosen `http(s):` URL for `web_fetch`'s built-in loader
 * (`@actovia-ai/web-reader`'s `fetchPinned`): the host is resolved once,
 * `assertAddressesNotActoviaApi` judges those addresses and the socket
 * connects to exactly them, so a DNS answer that rebinds to 127.0.0.1:60223
 * between the check and the connect is never used. A private or loopback
 * address is otherwise allowed (a local dev server, an intranet page). Never
 * follows a redirect; the body is capped.
 */
export function fetchPinned(
  url: URL,
  options: PinnedFetchOptions = {}
): Promise<Response> {
  return fetchPinnedWith(url, {
    ...options,
    checkAddresses: assertAddressesNotActoviaApi,
    userAgent: 'Mozilla/5.0 (Actovia web_fetch)'
  })
}
