import type { i18n as I18nInstance } from 'i18next'

import { BASE_URL, IS_WEB_CLIENT } from '../constants/systems'
import { WEB_CLIENT_HEADER, WEB_SESSION_EVENT } from '../types/web-terminal'

type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'

type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer'

interface HttpFetchOptions {
  method?: HttpMethod
  headers?: Record<string, string>
  body?: Record<string, unknown> | FormData | Blob | ArrayBuffer | string
  query?: Record<string, string | number | boolean>
  timeout?: number // in milliseconds
  responseType?: ResponseType // expected response type
}

function isPlainObject(value: object): value is Record<string, object> {
  return (
    Object.prototype.toString.call(value) === '[object Object]' &&
    (value.constructor === Object || value.constructor == null)
  )
}

/**
 * Anthropic-style error response shape, extended with the i18n payload
 * `AppError.toJSON()` now emits:
 * { type: "error", error: { code, message, params?, hasCustomMessage } }
 */
interface ErrorResponseBody {
  type: 'error'
  error: {
    code: string
    message: string
    params?: Record<string, string | number>
    hasCustomMessage?: boolean
  }
}

function isErrorResponse(data: unknown): data is ErrorResponseBody {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    (data as ErrorResponseBody).type === 'error' &&
    'error' in data &&
    typeof (data as ErrorResponseBody).error?.message === 'string'
  )
}

export class HttpError extends Error {
  public readonly statusCode: number
  public readonly code: string
  public readonly params?: Record<string, string | number>
  public readonly hasCustomMessage: boolean

  constructor(
    statusCode: number,
    code: string,
    message: string,
    params?: Record<string, string | number>,
    hasCustomMessage = true
  ) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.code = code
    this.params = params
    this.hasCustomMessage = hasCustomMessage
  }
}

interface ErrorI18n {
  t: (key: string, params?: Record<string, string | number>) => string
  exists: (key: string) => boolean
}

/**
 * Adapts a real i18next instance to the `ErrorI18n` shape `getHttpErrorMessage`
 * expects. i18next's own `t()`/`exists()` types are keyed against the
 * project's declared resource shape (`CustomTypeOptions`), which rejects a
 * runtime-computed key like `errors:code.${code}` at the type level — the casts
 * here are the one place that's intentionally suppressed.
 */
export function toErrorI18n(instance: I18nInstance): ErrorI18n {
  return {
    t: (key, params) => instance.t(key as never, params),
    exists: (key) => instance.exists(key as never)
  }
}

/**
 * Resolves a user-facing message for a failed HTTP request.
 *
 * Priority, once an `i18n` instance is passed:
 * 1. `err.hasCustomMessage` — a caller (server-side `AppError` override, or
 *    a genuinely dynamic client-side failure like a timeout's raw text)
 *    provided real, specific text. Show it verbatim, untranslated — this
 *    is deliberately not templated, since it's arbitrary exception text.
 * 2. Otherwise the error is purely code-driven: translate `errors:code.<code>`
 *    with `err.params`.
 * 3. If that key doesn't exist, fall back to `errors:http.<statusCode>`,
 *    then `errors:http.unknown`.
 *
 * When `i18n` is omitted, behavior is unchanged from before this pass:
 * always return `err.message` for any `HttpError`.
 */
export function getHttpErrorMessage(
  err: unknown,
  i18n?: ErrorI18n
): string | undefined {
  if (!(err instanceof HttpError)) return undefined
  if (err.hasCustomMessage || !i18n) return err.message

  const codeKey = `errors:code.${err.code}`
  if (i18n.exists(codeKey)) return i18n.t(codeKey, err.params)

  const statusKey = `errors:http.${err.statusCode}`
  return i18n.exists(statusKey)
    ? i18n.t(statusKey)
    : i18n.t('errors:http.unknown')
}

export async function fetcher<T>(
  url: string,
  options: HttpFetchOptions = {}
): Promise<T> {
  const {
    method = 'GET',
    headers = {},
    body = null,
    query = null,
    timeout = 0,
    responseType = 'json'
  } = options

  // Build query string if query parameters are provided
  let requestUrl = BASE_URL + url
  if (query && typeof query === 'object') {
    const queryString = new URLSearchParams(
      Object.entries(query).map(([key, value]): [string, string] => [
        key,
        String(value)
      ])
    ).toString()
    if (queryString) {
      requestUrl += (url.includes('?') ? '&' : '?') + queryString
    }
  }

  // Clone headers to avoid mutating input
  const fetchHeaders: Record<string, string> = {
    ...(IS_WEB_CLIENT ? { [WEB_CLIENT_HEADER]: '1' } : {}),
    ...headers
  }

  // Prepare fetch options
  const fetchOptions: RequestInit = {
    method: method.toUpperCase(),
    headers: fetchHeaders
  }

  // Handle body for methods that support it
  if (
    body &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(fetchOptions.method!)
  ) {
    // Detect if body is FormData
    const isFormData =
      typeof FormData !== 'undefined' && body instanceof FormData

    if (isFormData) {
      fetchOptions.body = body
      // Remove Content-Type header if set, let browser handle it
      if (fetchHeaders['Content-Type']) delete fetchHeaders['Content-Type']
      if (fetchHeaders['content-type']) delete fetchHeaders['content-type']
    } else if (
      typeof body === 'object' &&
      body !== null &&
      isPlainObject(body as object)
    ) {
      if (!fetchHeaders['Content-Type'] && !fetchHeaders['content-type']) {
        fetchHeaders['Content-Type'] = 'application/json;charset=UTF-8'
      }
      fetchOptions.body = JSON.stringify(body)
    } else {
      // For other types (Blob, ArrayBuffer, string, etc.), send as is
      fetchOptions.body = body as RequestInit['body']
      // Content-Type should be set by caller if needed
    }
  }

  // Handle timeout with AbortController if timeout > 0
  let controller: AbortController | undefined
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  if (timeout > 0) {
    controller = new AbortController()
    fetchOptions.signal = controller.signal
    timeoutId = setTimeout(() => controller!.abort(), timeout)
  }

  try {
    const response = await fetch(requestUrl, fetchOptions)
    if (IS_WEB_CLIENT && (response.status === 401 || response.status === 423))
      (
        globalThis as unknown as { dispatchEvent(event: Event): boolean }
      ).dispatchEvent(new Event(WEB_SESSION_EVENT))
    if (timeoutId !== undefined) clearTimeout(timeoutId)

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || ''

      // Try to parse Anthropic-style error JSON
      if (contentType.includes('application/json')) {
        const data = (await response.json()) as { message?: string }
        if (isErrorResponse(data)) {
          throw new HttpError(
            response.status,
            data.error.code,
            data.error.message,
            data.error.params,
            data.error.hasCustomMessage ?? true
          )
        }
        // Fallback for non-standard JSON errors — no ErrorCode drove this,
        // so route it through the UNKNOWN_ERROR code-driven translation
        // instead of showing the raw JSON.stringify'd body.
        throw new HttpError(
          response.status,
          'UNKNOWN_ERROR',
          data.message || JSON.stringify(data),
          undefined,
          false
        )
      }

      // Plain text fallback — same reasoning as above.
      const text = await response.text()
      throw new HttpError(
        response.status,
        'UNKNOWN_ERROR',
        text || `HTTP error! status: ${response.status}`,
        undefined,
        false
      )
    }

    switch (responseType) {
      case 'json':
        return (await response.json()) as T
      case 'text':
        return (await response.text()) as unknown as T
      case 'blob':
        return (await response.blob()) as unknown as T
      case 'arrayBuffer':
        return (await response.arrayBuffer()) as unknown as T
      default:
        return (await response.json()) as T
    }
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpError(
        408,
        'TIMEOUT',
        'Request timed out.',
        undefined,
        false
      )
    }
    throw error
  }
}
