import * as cheerio from 'cheerio'
import TurndownService from 'turndown'

import { fetchPinned } from './pinned-fetch'

/**
 * A page as Markdown, for a model to read: Jina Reader first (it renders
 * pages built with JavaScript), then the page fetched here and its main
 * content turned into Markdown with cheerio + turndown, or a PDF through the
 * caller's parser.
 */
export interface ReadDocument {
  /** The page's `og:image` / `twitter:image`, or `''`. */
  ogImage: string
  type: 'pdf' | 'html'
  content: string
}

export interface ReadDirectOptions {
  signal?: AbortSignal
  /**
   * One hop: a GET that never follows a redirect. Default `fetchPinned`
   * (the connection pinned to the addresses it judged).
   */
  fetchHop?: (url: URL, signal?: AbortSignal) => Promise<Response>
  /**
   * Runs before every hop, the first included; throw to refuse it. An error
   * it throws is rethrown, every other failure reads as "no document".
   */
  guard?: (url: URL) => Promise<void> | void
  /** A PDF's text. Without it a PDF is not read. */
  parsePdf?: (blob: Blob) => Promise<string>
  /** Default 5. */
  maxRedirects?: number
  /**
   * An error from `fetchHop` that is a refusal, not a failed read — thrown
   * like `guard`'s (`fetchPinned`'s `checkAddresses` refuses inside the hop).
   */
  isRefusal?: (error: unknown) => boolean
}

const TURNDOWN_OPTIONS = {
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
} as const

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

class GuardRefusal {
  constructor(readonly error: unknown) {}
}

function ogImageOf($: cheerio.CheerioAPI) {
  return (
    $('meta[property="og:image"]').attr('content') ??
    $('meta[name="og:image"]').attr('content') ??
    $('meta[name="twitter:image"]').attr('content') ??
    ''
  )
}

/** The page's main content as HTML (article, #content, main… or body). */
export function extractHtmlBody(
  html: string
): { ogImage: string; html: string } | null {
  try {
    const $ = cheerio.load(html)

    $('script, style, noscript, iframe, svg, footer, nav, header').remove()

    return {
      ogImage: ogImageOf($),
      html:
        $('article').html() ||
        $('#content').html() ||
        $('.content').html() ||
        $('#main').html() ||
        $('main').html() ||
        $('body').html() ||
        ''
    }
  } catch {
    return null
  }
}

export function htmlToMarkdown(html: string): string {
  return new TurndownService(TURNDOWN_OPTIONS).turndown(html)
}

/**
 * GETs `initial`, following redirects here so every hop passes `guard`
 * before its request is made. Only `http:` / `https:` hops are followed.
 */
async function fetchFollowing(
  initial: URL,
  {
    signal,
    fetchHop = (url, s) => fetchPinned(url, { signal: s }),
    guard,
    maxRedirects = 5
  }: ReadDirectOptions
) {
  let current = initial
  for (let hop = 0; ; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new Error(`Refused: ${current.protocol} is not http(s)`)
    }
    if (guard) {
      try {
        await guard(current)
      } catch (error) {
        throw new GuardRefusal(error)
      }
    }
    const response = await fetchHop(current, signal)
    if (!REDIRECT_STATUSES.has(response.status)) return response
    const location = response.headers.get('location')
    if (!location || hop >= maxRedirects) return response
    current = new URL(location, current)
  }
}

/**
 * The page fetched from this process. Null for anything that is not a
 * document: a bad URL, an error status (a 404 page is not content), a
 * redirect left unresolved, a type other than HTML or PDF, a network
 * failure. What `guard` throws is thrown.
 */
export async function readDirect(
  link: string,
  options: ReadDirectOptions = {}
): Promise<ReadDocument | null> {
  try {
    let initial: URL
    try {
      initial = new URL(link)
    } catch {
      return null
    }
    const response = await fetchFollowing(initial, options)
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') ?? ''

    if (contentType.includes('application/pdf')) {
      if (!options.parsePdf) return null
      const pdf = await options.parsePdf(await response.blob()).catch(() => '')
      return pdf ? { ogImage: '', type: 'pdf', content: pdf } : null
    }

    if (contentType.includes('text/html')) {
      const dom = extractHtmlBody(await response.text())
      if (!dom?.html) return null
      const markdown = htmlToMarkdown(dom.html)
      return markdown
        ? { ogImage: dom.ogImage, type: 'html', content: markdown }
        : null
    }

    return null
  } catch (error) {
    if (error instanceof GuardRefusal) throw error.error
    if (options.isRefusal?.(error)) throw error
    return null
  }
}

/**
 * The page through Jina Reader (`https://r.jina.ai/<url>`), which fetches it
 * on its own servers. Null when Jina answers with an error or nothing.
 */
export async function readWithJina(
  link: string,
  {
    signal,
    fetch: fetchFn = globalThis.fetch
  }: { signal?: AbortSignal; fetch?: typeof fetch } = {}
): Promise<ReadDocument | null> {
  try {
    const response = await fetchFn(`https://r.jina.ai/${link}`, {
      headers: { Accept: 'text/plain' },
      signal
    })
    if (!response.ok) return null
    const content = await response.text()
    return content ? { ogImage: '', type: 'html', content } : null
  } catch {
    return null
  }
}

/** Jina Reader, then `readDirect` when Jina has nothing. */
export async function readPage(
  link: string,
  options: ReadDirectOptions = {}
): Promise<ReadDocument | null> {
  return (
    (await readWithJina(link, { signal: options.signal })) ??
    (await readDirect(link, options))
  )
}
