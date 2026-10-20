import http2 from 'http2'

import { LAN_SERVER_PORT } from '@actovia/shared/constants/systems'
import type { serve as honoServe, ServerType } from '@hono/node-server'

import { logger } from '../logger'
import type { Bindings } from '../server/types'
import type { LanCertificate } from './certificate'

export interface LanListener {
  /** Bring the listener in line with whether it is wanted. */
  sync(): Promise<void>
  stop(): void
  isRunning(): boolean
  /** The port actually bound, while running. */
  port(): number | null
}

/**
 * The HTTPS face of the API — the only one the LAN can reach. It exists only
 * while it has a reason to: a paired device to serve, or a pairing window to
 * answer. `sync()` is called after anything that can change that, and makes the
 * listener match. Until the first device is paired, nothing listens at all.
 */
export function createLanListener(deps: {
  fetch(request: Request, env: Bindings): Response | Promise<Response>
  wanted(): Promise<boolean>
  certificate(): Promise<LanCertificate>
  serve: typeof honoServe
  /** Defaults to LAN_SERVER_PORT; tests bind an ephemeral one. */
  port?: number
}): LanListener {
  let server: ServerType | null = null
  // One transition at a time: two overlapping syncs must not both start it.
  let chain: Promise<void> = Promise.resolve()

  async function reconcile(): Promise<void> {
    const wanted = await deps.wanted()
    if (wanted && !server) {
      const { certPem, keyPem } = await deps.certificate()
      // Resolved on `listening`, not on return: whoever awaited this sync is
      // about to show a QR code, and the phone that scans it connects at once.
      // A port that cannot be bound is a failed sync, not an uncaught exception.
      await new Promise<void>((resolve, reject) => {
        const starting = deps.serve(
          {
            fetch: (request, env) =>
              deps.fetch(request, { ...(env as Bindings), listener: 'lan' }),
            port: deps.port ?? LAN_SERVER_PORT,
            hostname: '0.0.0.0',
            // HTTP/2 where the client offers it (the phone's URLSession
            // does, over ALPN): its page, pictures, media and live streams
            // share one connection, where HTTP/1.1 opened several, each its
            // own TLS handshake over Tailscale. HTTP/1.1 clients still get it.
            createServer: http2.createSecureServer,
            serverOptions: { cert: certPem, key: keyPem, allowHTTP1: true }
          },
          () => {
            server = starting
            resolve()
          }
        )
        starting.once('error', reject)
      })
      logger.info('lan', 'LAN listener up', {
        port: deps.port ?? LAN_SERVER_PORT
      })
    } else if (!wanted && server) {
      server.close()
      server = null
      logger.info('lan', 'LAN listener down')
    }
  }

  return {
    sync() {
      // Run after whatever is in flight, whether that succeeded or not — a
      // failed sync must not wedge every later one.
      const run = chain.then(reconcile, reconcile)
      chain = run.catch(() => {})
      return run
    },
    stop() {
      server?.close()
      server = null
    },
    isRunning: () => server !== null,
    port() {
      const address = server?.address()
      return address && typeof address === 'object' ? address.port : null
    }
  }
}
