// @vitest-environment happy-dom
import { REPORTED_STACK_MAX_CHARS } from '@actovia/shared/constants/systems'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { installGlobalErrorReporting, reportRendererError } =
  await import('@/lib/report-error')

function lastRequest() {
  const fetchMock = globalThis.fetch as unknown as {
    mock: { calls: [string, { body?: string }][] }
  }
  const [url, init] = fetchMock.mock.calls.at(-1)!
  return { url, body: init.body ? JSON.parse(init.body) : undefined }
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: () => Promise.resolve('')
    })
  )
}

describe('reportRendererError', () => {
  beforeEach(stubFetch)
  afterEach(() => vi.unstubAllGlobals())

  it('posts level, scope, message and attributes, folding the stack in', () => {
    reportRendererError('tool-card', new Error('boom'), {
      toolName: 'weather'
    })
    const { url, body } = lastRequest()
    expect(url).toContain('/api/v1/logs')
    expect(body).toMatchObject({
      level: 'error',
      scope: 'tool-card',
      message: 'boom'
    })
    expect(body.attributes.toolName).toBe('weather')
    expect(body.attributes.stack).toContain('boom')
  })

  it('sends a component stack beside the stack of the error', () => {
    const componentStack = '\n    at WeatherCard\n    at ErrorBoundary'
    reportRendererError('tool-card', new Error('boom'), {
      toolName: 'weather',
      componentStack
    })
    const { body } = lastRequest()
    expect(body.attributes).toMatchObject({
      toolName: 'weather',
      componentStack
    })
    expect(body.attributes.stack).toContain('boom')
  })

  it('sends no empty component stack', () => {
    reportRendererError('tool-card', new Error('boom'), {
      componentStack: ''
    })
    expect(lastRequest().body.attributes).not.toHaveProperty('componentStack')
    reportRendererError('tool-card', new Error('boom'), {
      componentStack: null
    })
    expect(lastRequest().body.attributes).not.toHaveProperty('componentStack')
  })

  it('bounds the stacks it sends to what the main process reads', () => {
    const error = new Error('deep')
    error.stack = `Error: deep\n${'    at Frame (file:///app/x.js:1:1)\n'.repeat(5000)}`
    reportRendererError('tool-card', error, {
      componentStack: '    at Component (file:///app/x.js:1:1)\n'.repeat(5000)
    })
    const { body } = lastRequest()
    expect(body.attributes.stack.length).toBe(REPORTED_STACK_MAX_CHARS)
    expect(body.attributes.componentStack.length).toBe(REPORTED_STACK_MAX_CHARS)
    // The head is what is kept: the frames nearest the throw.
    expect(body.attributes.stack.startsWith('Error: deep\n')).toBe(true)
  })

  it('never throws, even when the request itself fails', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(() => reportRendererError('scope', new Error('x'))).not.toThrow()
  })
})

describe('installGlobalErrorReporting', () => {
  // Installed once for the file: the guard against double-registration is
  // exactly what makes calling it again in a later test a no-op, so the
  // later tests below double as that guard's proof.
  installGlobalErrorReporting()

  beforeEach(stubFetch)
  afterEach(() => vi.unstubAllGlobals())

  it('reports an uncaught error under scope "window"', () => {
    window.dispatchEvent(
      new ErrorEvent('error', {
        error: new Error('boom'),
        filename: 'app.js',
        lineno: 12,
        colno: 3
      })
    )
    const { body } = lastRequest()
    expect(body.scope).toBe('window')
    expect(body.message).toBe('boom')
    expect(body.attributes).toMatchObject({
      filename: 'app.js',
      lineno: 12,
      colno: 3
    })
  })

  it('drops the well-known ResizeObserver false positive', () => {
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'ResizeObserver loop completed with undelivered notifications.'
      })
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('reports an unhandled promise rejection under its own scope', () => {
    const event = new Event('unhandledrejection')
    Object.defineProperty(event, 'reason', { value: new Error('rejected') })
    window.dispatchEvent(event)
    const { body } = lastRequest()
    expect(body.scope).toBe('unhandled-rejection')
    expect(body.message).toBe('rejected')
  })

  it('installing again does not register a second listener', () => {
    installGlobalErrorReporting()
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('once') }))
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})
