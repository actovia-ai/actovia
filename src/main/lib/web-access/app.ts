import type { WebAccessConfig } from '@actovia/shared/types/web-terminal'
import { WEB_CLIENT_HEADER } from '@actovia/shared/types/web-terminal'
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON
} from '@simplewebauthn/server'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'

import type { Bindings } from '../server/types'
import { WEB_ABSOLUTE_MS } from './sessions'
import type { createWebTerminals } from './terminals'

export const DEVICE_COOKIE = '__Host-actovia-device'
export const SESSION_COOKIE = '__Host-actovia-session'
const PREFIX = '/api/web-terminal'
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])
const NATIVE_PATHS = [
  '/api/v1/devices',
  '/api/v1/host',
  '/api/v1/lock',
  '/api/v1/web-access',
  '/api/v1/pair'
]
const isArtifactSandboxPath = (path: string) =>
  path === '/api/v1/artifacts/sandbox' ||
  path.startsWith('/api/v1/artifacts/sandbox/')

export function createWebApp(deps: {
  config(): WebAccessConfig
  terminals: ReturnType<typeof createWebTerminals>
  hostLocked(): boolean
  api(request: Request, bindings: Bindings): Response | Promise<Response>
  asset(path: string): Promise<Response>
}) {
  const app = new Hono()
  const terminals = deps.terminals
  const refuse = (status: number, code: string) =>
    Response.json({ type: 'error', error: { code, message: code } }, { status })

  app.use('*', async (c, next) => {
    const config = deps.config()
    if (!config.enabled || !config.origin) return c.notFound()
    const host = c.req.header('host')?.toLowerCase()
    const origin = c.req.header('origin')
    const artifactSandboxRequest = isArtifactSandboxPath(c.req.path)
    if (
      host !== new URL(config.origin).host.toLowerCase() ||
      (origin !== undefined &&
        origin !== config.origin &&
        !(artifactSandboxRequest && origin === 'null'))
    )
      return refuse(403, 'FORBIDDEN_ORIGIN')
    if (
      !SAFE.has(c.req.method) &&
      (origin !== config.origin || c.req.header(WEB_CLIENT_HEADER) !== '1')
    )
      return refuse(403, 'WEB_CSRF_REQUIRED')
    await next()
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    c.header(
      'Content-Security-Policy',
      artifactSandboxRequest
        ? `default-src 'none'; script-src ${config.origin} 'unsafe-inline' 'unsafe-eval'; style-src ${config.origin} 'unsafe-inline'; img-src ${config.origin} data: blob:; font-src ${config.origin} data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors ${config.origin}; sandbox allow-scripts`
        : "frame-ancestors 'none'; base-uri 'none'"
    )
    c.header('Cache-Control', 'no-store')
  })
  app.use(`${PREFIX}/*`, bodyLimit({ maxSize: 128 * 1024 }))

  const cookies = (c: Parameters<typeof getCookie>[0]) => ({
    binding: getCookie(c, DEVICE_COOKIE) ?? '',
    session: getCookie(c, SESSION_COOKIE) ?? ''
  })

  // Public compiled runtime only: generated code is supplied by the parent.
  // Enforce an opaque origin even when this page is opened without an iframe.
  app.get('/api/v1/artifacts/sandbox/*', async (c) => {
    const response = await deps.asset(c.req.path)
    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(response.body, { status: response.status, headers })
  })
  app.all('/api/v1/artifacts/sandbox/*', () => refuse(403, 'FORBIDDEN'))
  app.all('/api/v1/artifacts/sandbox', () => refuse(403, 'FORBIDDEN'))
  const setSession = (c: Parameters<typeof setCookie>[0], value: string) =>
    setCookie(c, SESSION_COOKIE, value, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: WEB_ABSOLUTE_MS / 1000
    })

  app.get(PREFIX, async (c) => {
    const { binding, session } = cookies(c)
    const device = await terminals.device(binding)
    if (deps.hostLocked()) terminals.sessions.revoke()
    return c.json({
      paired: !!device,
      unlocked:
        !!device && !!terminals.sessions.read(session, device.id, binding),
      ...(device ? { deviceName: device.name } : {})
    })
  })

  app.post(`${PREFIX}/pair/options`, async (c) => {
    if (await terminals.device(cookies(c).binding))
      return refuse(409, 'WEB_ALREADY_PAIRED')
    const { code, name } = await c.req.json()
    if (
      typeof code !== 'string' ||
      code.length > 128 ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 64
    )
      return refuse(400, 'VALIDATION_FAILED')
    return c.json(
      await terminals.registrationOptions(
        code,
        name.trim(),
        deps.config().origin
      )
    )
  })

  app.post(`${PREFIX}/pair/verify`, async (c) => {
    if (await terminals.device(cookies(c).binding))
      return refuse(409, 'WEB_ALREADY_PAIRED')
    const { requestId, response } = await c.req.json()
    if (
      typeof requestId !== 'string' ||
      requestId.length > 64 ||
      !response ||
      typeof response !== 'object'
    )
      return refuse(400, 'VALIDATION_FAILED')
    const paired = await terminals.finishRegistration(
      requestId,
      response as RegistrationResponseJSON,
      deps.config().origin
    )
    setCookie(c, DEVICE_COOKIE, paired.token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: 90 * 24 * 60 * 60
    })
    setSession(c, paired.session)
    return c.json({ paired: true, unlocked: true })
  })

  app.post(`${PREFIX}/unlock/options`, async (c) =>
    c.json(
      await terminals.authenticationOptions(
        cookies(c).binding,
        deps.config().origin
      )
    )
  )
  app.post(`${PREFIX}/unlock/verify`, async (c) => {
    const { requestId, response } = await c.req.json()
    if (
      typeof requestId !== 'string' ||
      requestId.length > 64 ||
      !response ||
      typeof response !== 'object'
    )
      return refuse(400, 'VALIDATION_FAILED')
    const session = await terminals.finishAuthentication(
      cookies(c).binding,
      requestId,
      response as AuthenticationResponseJSON,
      deps.config().origin
    )
    setSession(c, session)
    return c.json({ paired: true, unlocked: true })
  })

  app.post(`${PREFIX}/lock`, async (c) => {
    const device = await terminals.device(cookies(c).binding)
    if (device) terminals.sessions.revoke(device.id)
    deleteCookie(c, SESSION_COOKIE, {
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Strict'
    })
    return c.json({ ok: true })
  })

  app.post(`${PREFIX}/forget`, async (c) => {
    const device = await terminals.device(cookies(c).binding)
    if (device) {
      // The owner of this binding can forget itself; no other id is accepted.
      await terminals.forget(device.id)
    }
    deleteCookie(c, DEVICE_COOKIE, {
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Strict'
    })
    deleteCookie(c, SESSION_COOKIE, {
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Strict'
    })
    return c.json({ paired: false, unlocked: false })
  })

  app.post(`${PREFIX}/activity`, async (c) => {
    const { binding, session } = cookies(c)
    const device = await terminals.device(binding)
    if (deps.hostLocked()) terminals.sessions.revoke()
    if (!device || !terminals.sessions.touch(session, device.id, binding))
      return refuse(401, 'WEB_SESSION_REQUIRED')
    return c.json({ ok: true })
  })

  app.all('/api/*', async (c) => {
    const { binding, session } = cookies(c)
    const device = await terminals.device(binding)
    if (deps.hostLocked()) terminals.sessions.revoke()
    const request =
      device && terminals.sessions.track(session, device.id, binding)
    if (!device || !request) return refuse(401, 'WEB_SESSION_REQUIRED')
    if (
      NATIVE_PATHS.some(
        (path) => c.req.path === path || c.req.path.startsWith(`${path}/`)
      )
    ) {
      request.release()
      return refuse(403, 'FORBIDDEN')
    }
    try {
      const response = await deps.api(
        new Request(c.req.raw, {
          signal: AbortSignal.any([c.req.raw.signal, request.signal])
        }),
        {
          listener: 'web',
          webDeviceId: device.id,
          webOrigin: deps.config().origin
        }
      )
      if (
        !response.body ||
        !response.headers.get('content-type')?.startsWith('text/event-stream')
      ) {
        request.release()
        return response
      }
      const reader = response.body.getReader()
      const cancel = () => {
        void reader.cancel().catch(() => {})
      }
      request.signal.addEventListener('abort', cancel, { once: true })
      if (request.signal.aborted) cancel()
      const release = () => {
        request.signal.removeEventListener('abort', cancel)
        request.release()
      }
      const body = new ReadableStream({
        async pull(controller) {
          try {
            const part = await reader.read()
            if (part.done) {
              release()
              controller.close()
            } else controller.enqueue(part.value)
          } catch (error) {
            release()
            controller.error(error)
          }
        },
        async cancel(reason) {
          release()
          await reader.cancel(reason)
        }
      })
      return new Response(body, {
        status: response.status,
        headers: response.headers
      })
    } catch (error) {
      request.release()
      throw error
    }
  })

  app.get('*', (c) => deps.asset(c.req.path))
  app.onError((error, c) => {
    if (error instanceof HTTPException && error.status === 413)
      return c.json(
        {
          type: 'error',
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'PAYLOAD_TOO_LARGE' }
        },
        413
      )
    // Authenticator responses, cookies and pairing codes never reach logs/errors.
    return c.json(
      {
        type: 'error',
        error: {
          code: 'WEB_VERIFICATION_FAILED',
          message: 'WEB_VERIFICATION_FAILED'
        }
      },
      400
    )
  })
  return app
}
