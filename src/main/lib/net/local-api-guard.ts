import { createLocalPortGuard } from '@actovia-ai/web-reader'
import { LAN_SERVER_PORT, SERVER_PORT } from '@actovia/shared/constants/systems'

/**
 * `web_fetch` (and anything else that fetches a model-chosen URL from this
 * process, such as deep research's own page fetch, if it grows one) must
 * never be able to reach Actovia's own API — a page the model asks to fetch
 * could otherwise read back settings, masked keys, or anything else the
 * loopback or LAN listener serves.
 *
 * The rule is narrower than `safe-fetch.ts`'s "must be public" (used for
 * images): only a URL whose host resolves to loopback, an unspecified
 * address, or one of this machine's own network interfaces — AND whose port
 * is one of the two Actovia listens on (`SERVER_PORT`, `LAN_SERVER_PORT`) —
 * is refused. Everything else on `localhost`, a LAN IP or a private address
 * (another local dev server, an intranet host) stays reachable — that is a
 * supported `web_fetch` use case, not the threat this guards against.
 *
 * `assertNotActoviaApi` pre-resolves a host; the connection itself is pinned
 * by `net/pinned-fetch.ts` (`web_fetch`'s built-in loader), which resolves
 * once, judges those addresses with `assertAddressesNotActoviaApi` and
 * connects to exactly them — so a DNS answer that rebinds between check and
 * connect is never used. Every redirect hop is re-checked by the caller.
 * The rule itself is `@actovia-ai/web-reader`'s `createLocalPortGuard`.
 */

export class LocalApiTargetError extends Error {
  constructor() {
    super('Actovia cannot fetch its own API.')
    this.name = 'LocalApiTargetError'
  }
}

const guard = createLocalPortGuard({
  ports: [SERVER_PORT, LAN_SERVER_PORT],
  error: () => new LocalApiTargetError()
})

/** Whether `url`'s port is one of the two Actovia's API listens on. */
export function isGuardedPort(url: URL): boolean {
  return guard.isGuardedPort(url)
}

/**
 * The same rule against addresses already resolved — for a caller that pins
 * its connection to them (`net/pinned-fetch.ts`), so the addresses judged are
 * the ones connected to. Throws `LocalApiTargetError`.
 */
export function assertAddressesNotActoviaApi(
  url: URL,
  addresses: readonly string[]
): void {
  guard.assertAddresses(url, addresses)
}

/**
 * Refuses `url` when its host resolves to this machine (loopback, an
 * unspecified address, or one of its own interfaces) AND its port is
 * `SERVER_PORT` or `LAN_SERVER_PORT`, by throwing `LocalApiTargetError`.
 * Resolves (does nothing) otherwise, including when `url`'s host cannot be
 * resolved at all — there is no address to reach Actovia's API at either
 * way, and the real fetch this guards will fail on its own for the same
 * reason.
 */
export function assertNotActoviaApi(url: URL): Promise<void> {
  return guard.assertUrl(url)
}
