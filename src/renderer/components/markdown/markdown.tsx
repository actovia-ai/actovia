import { useMarkdownBlocks } from '@actovia-ai/streaming-markdown/react'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { entityTitle } from '@actovia/shared/utils/entity-link'
import {
  Tick02Icon,
  Copy01Icon,
  SourceCodeIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import 'katex/dist/katex.min.css'
import { useTheme } from 'next-themes'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import SyntaxHighlighter from 'react-syntax-highlighter'

import { useClipboard } from '@/hooks/use-clipboard'
import {
  INCOMPLETE_LINK_HREF,
  healStreamingTail,
  splitMarkdownBlocks
} from '@/lib/markdown-blocks'
import {
  rehypePluginsStable,
  remarkPluginsStable
} from '@/lib/markdown-plugins'
import { cn } from '@/lib/utils'

import {
  EntityLink,
  markdownUrlTransform
} from '../chat/interactive/entity-link'
import {
  fenceOf,
  InteractiveFence,
  MarkdownSourceContext
} from '../chat/interactive/interactive-fence'
import { xcodeDark, xcodeLight } from './code-themes'
import { languageName } from './language-names'
import {
  citationComponents,
  WebSearchRankMapContext
} from './markdown-citations'
import {
  AllowedImageUrlsContext,
  RemoteImage,
  SearchThumbnailUrlsContext,
  allowedImageUrls,
  searchThumbnailUrls
} from './remote-image'
import { WorkspacePathCode } from './workspace-path-code'

const themes = {
  light: { codeTheme: xcodeLight },
  dark: { codeTheme: xcodeDark }
}

// 12px (ChatGPT's) in the app's mono stack (`font-mono`: SF Mono on a Mac),
// the code tag inheriting so the two never disagree; no background of its own
// — the block's panel (`.markdown pre`) is the one background the header
// strip and the code share (owner, 2026-10-06).
const codeBlockStyle = {
  padding: '0.25rem 1rem 1rem',
  fontSize: '0.75rem',
  lineHeight: '1.6',
  margin: 0,
  background: 'transparent',
  // The outer `.markdown pre` already scrolls/caps height; keep this inner
  // element from establishing its own competing scroll or clipping.
  maxHeight: 'none',
  overflow: 'visible'
}
const codeTagProps = {
  style: { fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' }
}

/**
 * One top-level block of a document. Memoized on its text: while a reply
 * streams, only the last block or two are different from the frame before, so
 * everything above them — finished paragraphs, highlighted code, KaTeX — is
 * left alone instead of being re-parsed and re-rendered each frame.
 */
const MarkdownBlock = memo(function MarkdownBlock({
  src,
  before,
  components
}: {
  src: string
  /** The document's text above this block: where a reply's block is found. */
  before: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ReactMarkdown component overrides use broad prop types
  components: Record<string, any>
}) {
  const source = useMemo(() => ({ before, src }), [before, src])
  return (
    <MarkdownSourceContext.Provider value={source}>
      <ReactMarkdown
        remarkPlugins={remarkPluginsStable}
        rehypePlugins={rehypePluginsStable}
        urlTransform={markdownUrlTransform}
        components={components}
      >
        {src}
      </ReactMarkdown>
    </MarkdownSourceContext.Provider>
  )
})

/**
 * The text above each block; only the last one is healed, so the ones above
 * it are the document's own.
 */
function useTextsAbove(blocks: string[]): string[] {
  return useMemo(() => {
    let above = ''
    return blocks.map((block) => {
      const before = above
      above += block
      return before
    })
  }, [blocks])
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ReactMarkdown component overrides use broad prop types
function Pre({ className, children, node, ...rest }: any) {
  const pre = (
    <pre {...rest} className={className}>
      {children}
    </pre>
  )
  // A reply's block — a questionnaire, a confirmation, steps or a chart: the
  // control, or this code when it is not the turn's block (see
  // interactive-fence.tsx).
  const fence = fenceOf(node)
  return fence ? (
    <InteractiveFence
      kind={fence.kind}
      source={fence.source}
      offset={fence.offset}
    >
      {pre}
    </InteractiveFence>
  ) : (
    pre
  )
}

export function Markdown({
  src,
  webSearchResults
}: {
  src: string
  webSearchResults?: WebSearchResult[]
}) {
  const { t } = useTranslation('common')
  const { copied, handleCopy } = useClipboard()
  const { resolvedTheme } = useTheme()
  // resolvedTheme is undefined on first paint until next-themes hydrates;
  // fall back to the light theme so syntax highlighting renders something
  // sensible instead of crashing.
  const themeKey: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light'
  const { codeTheme } = useMemo(() => themes[themeKey], [themeKey])

  // History renders whole; a streaming reply block by block, its last block
  // healed (see `@actovia-ai/streaming-markdown/react`).
  const blocks = useMarkdownBlocks(src, splitMarkdownBlocks, healStreamingTail)
  const befores = useTextsAbove(blocks)

  const rankMap = useMemo(() => {
    if (!webSearchResults || webSearchResults.length === 0) return null
    return new Map(webSearchResults.map((r) => [r.rank, r]))
  }, [webSearchResults])

  // Which exact image URLs this run's own web search returned — see
  // remote-image.tsx. Kept out of `components` below for the same reason
  // `rankMap` is: it would otherwise invalidate that memo (and every
  // memoized block) whenever search results streamed in.
  const allowedUrls = useMemo(
    () => allowedImageUrls(webSearchResults),
    [webSearchResults]
  )
  const thumbnailUrls = useMemo(
    () => searchThumbnailUrls(webSearchResults),
    [webSearchResults]
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ReactMarkdown component overrides use broad prop types
  const components: Record<string, any> = useMemo(
    () => ({
      // 【N-source】, wherever it stands (see lib/remark-citations.ts).
      ...citationComponents,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
      code({ className, children, node, ...rest }: any) {
        // `[\w-]`: a fence named `actovia-ask` is labelled that, not `actovia`.
        // A fence with no language (an ASCII diagram, plain output) is still
        // a code block, labelled Text; its text ends in a newline, which
        // inline code never does.
        const language =
          /language-([\w-]+)/u.exec(className ?? '')?.[1] ??
          (String(children).endsWith('\n') ? 'text' : null)
        return language ? (
          <>
            {/* The strip stays put while the code under it scrolls — the
                panel (`.markdown pre`) is the scroll container — on the
                panel's own fill, as ChatGPT's. */}
            <section className="bg-code text-muted-foreground sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 text-xs">
              <span className="flex items-center gap-2 font-medium">
                <HugeiconsIcon
                  icon={SourceCodeIcon}

                  size={14}
                />
                {languageName(language)}
              </span>
              <div className="flex cursor-default items-center gap-6">
                {copied === children ? (
                  <span className="hover:text-foreground flex items-center gap-1.5">
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      size={14}
                      strokeWidth={2.5}
                    />
                    {t('state.copied')}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="hover:text-foreground flex items-center gap-1.5 transition-colors"
                    onClick={() => {
                      if (typeof children === 'string') {
                        handleCopy(children)
                      }
                    }}
                  >
                    <HugeiconsIcon
                      icon={Copy01Icon}

                      size={14}
                    />
                    {t('action.copy')}
                  </button>
                )}
              </div>
            </section>

            <SyntaxHighlighter
              {...rest}
              PreTag="div"
              className="font-mono"
              language={language}
              style={codeTheme}
              customStyle={codeBlockStyle}
              codeTagProps={codeTagProps}
              showLineNumbers={false}
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          </>
        ) : (
          // A path to a file the chat wrote becomes a link that opens it.
          <WorkspacePathCode {...rest} className={className}>
            {children}
          </WorkspacePathCode>
        )
      },
      pre: Pre,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
      li({ className, node, children, ...rest }: any) {
        return (
          <li {...rest} className={className}>
            {children}
          </li>
        )
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
      p({ className, node, children, ...rest }: any) {
        return (
          <p {...rest} className={className}>
            {children}
          </p>
        )
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
      img({ className, node, alt, ...rest }: any) {
        return <RemoteImage {...rest} alt={alt} className={className} />
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
      a({ className, children, node, href, ...rest }: any) {
        // A link still streaming in (see healStreamingTail) is text until
        // its URL is complete.
        if (href === INCOMPLETE_LINK_HREF) return <span>{children}</span>
        // A name that opens a Wikipedia summary (entity-link.tsx): never an
        // `<a href="entity:…">`.
        const entity = entityTitle(href)
        if (entity !== null)
          return <EntityLink title={entity}>{children}</EntityLink>
        // A scheme the URL rule emptied (`tel:`, `javascript:`, a bad
        // `entity:`): the words alone.
        if (!href) return <span>{children}</span>
        // Styling lives in globals.css `.markdown a` — primary color, no
        // underline by default, underline on hover. The previous always-bold
        // + always-underlined treatment made body text feel cluttered.
        return (
          <a
            {...rest}
            href={href}
            rel="noopener noreferrer"
            target="_blank"
            className={className}
          >
            {children}
          </a>
        )
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
      table({ className, children, node, ...rest }: any) {
        // No outer border / wrapper border — internal row dividers (handled
        // on thead/tr below) carry the structure. Wider tables still scroll
        // horizontally via overflow-x-auto without the boxed-in feel.
        return (
          <div className="mb-[var(--md-gap)] overflow-x-auto text-[0.9375em] leading-normal last:mb-0">
            <table {...rest} className={cn('w-full caption-bottom', className)}>
              {children}
            </table>
          </div>
        )
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
      thead({ className, children, node, ...rest }: any) {
        return (
          <thead
            {...rest}
            className={cn('[&_tr]:border-border [&_tr]:border-b', className)}
          >
            {children}
          </thead>
        )
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
      tbody({ className, children, node, ...rest }: any) {
        return (
          <tbody
            {...rest}
            className={cn('[&_tr:last-child]:border-0', className)}
          >
            {children}
          </tbody>
        )
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
      tr({ className, children, node, ...rest }: any) {
        return (
          <tr {...rest} className={cn('border-border border-b', className)}>
            {children}
          </tr>
        )
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
      th({ className, children, style, node, ...rest }: any) {
        return (
          <th
            {...rest}
            className={cn(
              'text-foreground py-2.5 pr-6 text-left align-top font-medium last:pr-0',
              className
            )}
          >
            {children}
          </th>
        )
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
      td({ className, children, node, ...rest }: any) {
        return (
          <td
            {...rest}
            className={cn(
              'text-foreground py-2.5 pr-6 align-top font-normal last:pr-0',
              className
            )}
          >
            {children}
          </td>
        )
      }
      // br() {
      //   return null
      // }
    }),
    [copied, handleCopy, codeTheme, t]
  )

  return (
    <WebSearchRankMapContext.Provider value={rankMap}>
      <AllowedImageUrlsContext.Provider value={allowedUrls}>
        <SearchThumbnailUrlsContext.Provider value={thumbnailUrls}>
          <section className="markdown max-w-none">
            {/* Blocks are only ever appended or grown in place — never reordered
              — so the index is their identity. They render as fragments: the DOM
              under .markdown is the same flat run of elements as before. */}
            {blocks.map((block, i) => (
              <MarkdownBlock
                // eslint-disable-next-line react/no-array-index-key -- see above
                key={i}
                src={block}
                before={befores[i]}
                components={components}
              />
            ))}
          </section>
        </SearchThumbnailUrlsContext.Provider>
      </AllowedImageUrlsContext.Provider>
    </WebSearchRankMapContext.Provider>
  )
}

export default memo(
  Markdown,
  (prevProps, nextProps) =>
    prevProps.src === nextProps.src &&
    prevProps.webSearchResults === nextProps.webSearchResults
)
