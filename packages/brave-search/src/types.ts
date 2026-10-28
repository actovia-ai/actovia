/* Brave API responses, as far as this package reads them. Every field is
 * optional: Brave leaves out what it does not have. */

export type BraveThumbnail = { src?: string; original?: string }

export type BraveLlmContextSource = {
  url: string
  title?: string
  snippets?: string[]
}

export type BraveLlmContextSourceMeta = {
  title?: string
  hostname?: string
  site_name?: string
  favicon?: string
  age?: string[]
  thumbnail?: BraveThumbnail
  snippet?: string
}

export type BraveLlmContextResponse = {
  grounding?: { generic?: BraveLlmContextSource[] }
  sources?: Record<string, BraveLlmContextSourceMeta>
}

export type BraveWebPageResult = {
  title?: string
  url?: string
  description?: string
  age?: string
  extra_snippets?: string[]
  profile?: { name?: string; long_name?: string }
  meta_url?: { hostname?: string; favicon?: string }
  thumbnail?: BraveThumbnail
}

export type BraveDiscussionResult = {
  title?: string
  url?: string
  description?: string
  age?: string
  data?: {
    forum_name?: string
    num_answers?: number
    question?: string
    top_comment?: string
  }
}

/** `rich` on a web search made with `enable_rich_callback`. */
export type BraveRichHint = {
  type?: string
  hint?: { vertical?: string; callback_key?: string }
}

export type BraveWebSearchResponse = {
  web?: { results?: BraveWebPageResult[] }
  news?: { results?: BraveWebPageResult[] }
  discussions?: { results?: BraveDiscussionResult[] }
  rich?: BraveRichHint
}

export type BraveImageResult = {
  title?: string
  url?: string
  source?: string
  thumbnail?: BraveThumbnail
  properties?: {
    url?: string
    placeholder?: string
    width?: number
    height?: number
  }
}

export type BraveImageSearchResponse = { results?: BraveImageResult[] }

export type BraveVideoResult = {
  title?: string
  url?: string
  description?: string
  age?: string
  /** Legacy: `video.duration` is where it lives now. */
  duration?: string
  source?: string
  thumbnail?: BraveThumbnail
  meta_url?: { hostname?: string }
  video?: {
    duration?: string
    views?: number
    creator?: string
    publisher?: string
  }
}

export type BraveVideoSearchResponse = { results?: BraveVideoResult[] }

export type BraveNewsResult = {
  title?: string
  url?: string
  description?: string
  source?: string
  age?: string
  page_age?: string
  thumbnail?: BraveThumbnail
  meta_url?: { hostname?: string; favicon?: string }
  /** The outlet's readable name ("ESPN", "The Guardian"). */
  profile?: { name?: string; long_name?: string }
}

export type BraveNewsSearchResponse = { results?: BraveNewsResult[] }

/**
 * `/web/rich`. Each result carries its data under the vertical's own key
 * (`weather`, `stock`, `currency`, `football`, …), whose shape is Brave's.
 */
export type BraveRichResponse = {
  type?: string
  results?: Array<
    {
      type?: string
      subtype?: string
      provider?: {
        type?: string
        name?: string
        url?: string
        long_name?: string
        img?: string
      }
      language?: string
    } & Record<string, unknown>
  >
  response_callback_info?: {
    vertical?: string
    callback_key?: string
    callback_status?: 'success' | 'failure' | string
    search_lang?: string
  }
}
