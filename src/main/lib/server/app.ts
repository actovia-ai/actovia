import { SERVER_PORT } from '@actovia/shared/constants/systems'
import { serve, ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { bootFauxProviderIfRequested } from '../ai/kernel/faux-boot'
import { initScheduler } from '../ai/philharmonic/scheduler'
import { getSettings } from '../db/queries'
import { initJobQueue } from '../jobs/worker'
import { initLan, stopLan, syncLan } from '../lan'
import { logger } from '../logger'
import {
  authGate,
  compressLan,
  createOriginGate,
  errorHandler,
  lockGate,
  presenceGate,
  traceMiddleware
} from './middlewares'
import agentsRouter from './routes/agents'
import analyticsRouter from './routes/analytics'
import artifactSandboxRouter from './routes/artifact-sandbox'
import artifactsRouter from './routes/artifacts'
import audioRouter from './routes/audio'
import backupRouter from './routes/backup'
import chatRouter from './routes/chat'
import computerUseRouter from './routes/computer-use'
import dbIoRouter from './routes/db-io'
import deepResearchRouter from './routes/deep-research'
import devicesRouter from './routes/devices'
import discoverRouter from './routes/discover'
import entityRouter from './routes/entity'
import healthRouter from './routes/health'
import historyRouter from './routes/history'
import { hostRouter, hostStatusRouter } from './routes/host'
import knowledgeBaseRouter from './routes/knowledge-base'
import lcmStatusRouter from './routes/lcm-status'
import lockRouter from './routes/lock'
import logsRouter from './routes/logs'
import mapsRouter from './routes/maps'
import mcpRouter from './routes/mcp'
import mediaRouter from './routes/media'
import memoryRouter from './routes/memory'
import pairRouter from './routes/pair'
import philharmonicRouter, { emitToAll } from './routes/philharmonic'
import projectsRouter from './routes/projects'
import s3UploaderRouter from './routes/s3-uploader'
import settingsRouter from './routes/settings'
import skillsRouter from './routes/skills'
import toolsRouter from './routes/tools'
import usageRouter from './routes/usage'
import workspaceRouter from './routes/workspace'
import type { Bindings, Variables } from './types'

// A Vite define, so only present in a build made by electron-forge — not under
// Vitest, where reading it bare would be a ReferenceError.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
const devServerUrl =
  typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string'
    ? MAIN_WINDOW_VITE_DEV_SERVER_URL
    : undefined

// Loopback only, both families: the renderer says `localhost`, which resolves
// to ::1 first. The LAN is served separately, over TLS (see ../lan/).
const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1']

/** The Hono app, without a listener — what both listeners serve. */
export function createApp() {
  // The Electron e2e's scripted provider; a no-op unless the env asks for it.
  bootFauxProviderIfRequested()

  const app = new Hono<{ Variables: Variables; Bindings: Bindings }>()

  // Middleware
  // Compression wraps everything below it, so it is registered first: every
  // response the LAN listener sends — refusals and errors included — goes
  // out brotli/gzip-compressed (loopback is left alone).
  app.use('*', compressLan)

  // Origin gate next, ahead of CORS: a rejected web origin gets a bare 403
  // with no `Access-Control-Allow-Origin`, so its page can't read even that.
  app.use('*', createOriginGate({ devOrigin: devServerUrl }))
  app.use('*', cors())

  // Auth gate: on the LAN listener, only a paired device's token gets further
  // (loopback passes straight through). Ahead of the lock gate, so an
  // unauthenticated request learns nothing — not even that the app is locked.
  app.use('/api/*', authGate)

  // Unlock, registered ahead of the lock gate so it is reachable while
  // locked — the one API route that has to be. Still behind authGate above.
  app.route('/api/v1/lock', lockRouter)
  // What the app is and whether it is locked, for `actovia status` — answered
  // while locked too (host.ts). The host routes that act sit in v1 below.
  app.route('/api/v1/host', hostStatusRouter)

  // Lock gate: reject all API access while the app is locked (423).
  app.use('/api/*', lockGate)

  // Presence gate: approving a paused tool call and managing devices need the
  // app window's own token on loopback — not just any local process (the
  // model's `terminal` can reach loopback). See presence-gate.ts.
  app.use('/api/*', presenceGate)

  // Trace gate: wrap each request in an AsyncLocalStorage trace so every
  // logger.* call while handling it shares one traceId; echo it as x-trace-id.
  app.use('/api/*', traceMiddleware)

  // Add setting to context for all routes (except setting route to avoid circular dependency)
  app.use('/api/*', async (c, next) => {
    // Get fresh settings on each request to ensure it's always up-to-date
    const settings = await getSettings()
    c.set('settings', settings)
    await next()
  })

  // Routes — every business endpoint lives under one version prefix so a
  // breaking change can ship as /api/v2 next to it instead of on top of it.
  // Clients (the renderer, tests/api, actovia-ios) address /api/v1/....
  const v1 = new Hono<{ Variables: Variables }>()
  v1.route('/chat', chatRouter)
  v1.route('/lcm', lcmStatusRouter)
  v1.route('/history', historyRouter)
  v1.route('/knowledge-base', knowledgeBaseRouter)
  v1.route('/settings', settingsRouter)
  v1.route('/skills', skillsRouter)
  v1.route('/audio', audioRouter)
  v1.route('/db-io', dbIoRouter)
  v1.route('/deep-research', deepResearchRouter)
  v1.route('/discover', discoverRouter)
  v1.route('/entity', entityRouter)
  v1.route('/computer-use', computerUseRouter)
  v1.route('/tools', toolsRouter)
  v1.route('/philharmonic', philharmonicRouter)
  v1.route('/s3', s3UploaderRouter)
  v1.route('/mcp', mcpRouter)
  v1.route('/memory', memoryRouter)
  v1.route('/health', healthRouter)
  v1.route('/usage', usageRouter)
  v1.route('/logs', logsRouter)
  v1.route('/backup', backupRouter)
  v1.route('/host', hostRouter)
  // Ahead of `/artifacts/:chatId/:artifactId`, which would take `sandbox/x`.
  v1.route('/artifacts/sandbox', artifactSandboxRouter)
  v1.route('/artifacts', artifactsRouter)
  v1.route('/media', mediaRouter)
  v1.route('/maps', mapsRouter)
  v1.route('/analytics', analyticsRouter)
  v1.route('/pair', pairRouter)
  v1.route('/devices', devicesRouter)
  v1.route('/workspace', workspaceRouter)
  v1.route('/agents', agentsRouter)
  v1.route('/projects', projectsRouter)
  app.route('/api/v1', v1)

  // Ping
  app.get('/', (c) => c.text('Actovia is running.'))

  // Global error handler
  app.onError(errorHandler)

  return app
}

// Export server functions
export async function connectHttpServer() {
  let servers: ServerType[] = []
  const app = createApp()

  return {
    close(callback?: (err?: Error) => void) {
      stopLan()
      const closing = servers
      servers = []
      if (closing.length === 0) return callback?.()
      let pending = closing.length
      for (const server of closing) {
        server.close((err) => {
          pending--
          if (err || pending === 0) callback?.(err)
        })
      }
    },
    start() {
      servers = LOOPBACK_ADDRESSES.map((hostname) => {
        const server = serve({
          fetch: (request, env) =>
            app.fetch(request, { ...(env as Bindings), listener: 'loopback' }),
          port: SERVER_PORT,
          hostname
        })
        // A machine with IPv6 switched off has no ::1 to bind; 127.0.0.1 alone
        // still serves it. Anything else (the port is taken) stays loud.
        server.on('error', (error: NodeJS.ErrnoException) => {
          if (hostname === '::1' && error.code === 'EADDRNOTAVAIL') {
            logger.warn('server', 'No IPv6 loopback to listen on', { hostname })
            return
          }
          throw error
        })
        return server
      })
      logger.info('server', 'Hono is running', {
        port: SERVER_PORT,
        addresses: LOOPBACK_ADDRESSES
      })

      // The LAN listener (HTTPS, token-gated) serves this same app; it comes up
      // now only if a device is already paired — see ../lan/.
      initLan((request, env) => app.fetch(request, env))
      void syncLan()

      // Initialize cron scheduler after server is up
      initScheduler(emitToAll).catch((err) =>
        logger.error('scheduler', 'Init error', { error: err })
      )
      initJobQueue()
    }
  }
}
