import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { ArrowLeft02Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { createContext, memo, useContext, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import removeMd from 'remove-markdown'

import { chipLabel, sourcesOf } from '@/lib/citation-chips'
import { CITATION_ELEMENT } from '@/lib/remark-citations'
import { cn } from '@/lib/utils'

import { Button } from '../ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card'
import { LazyLoadImage } from './lazy-load-image'
import { SourceFavicon } from './source-favicon'

/**
 * The 【N-source】 citation markers the model writes after a web search, as
 * hover-card chips. The markers are made nodes of the syntax tree by
 * `remarkCitations` (`lib/remark-citations.ts`), wherever they stand, and
 * drawn by `citationComponents` here; `chat/panel/chat-panel.tsx` and the
 * deep-research source list read `parseCitations`.
 */

// Matches 【1-source】 or 【1,2-source】
const citationGlobalRegex = /【([\d,\s]+)-source】/g

// eslint-disable-next-line react-refresh/only-export-components
export function parseCitations(text: string): number[] | null {
  const matches = [...text.matchAll(citationGlobalRegex)]
  if (matches.length === 0) return null
  return matches
    .flatMap((m) =>
      m[1].split(',').flatMap((n) => {
        const parsed = parseInt(n.trim(), 10)
        return isNaN(parsed) ? [] : [parsed]
      })
    )
    .sort((a, b) => a - b)
}

// Provides webSearchResults to TextWithCitations without dragging it through the
// ReactMarkdown `components` prop, which would invalidate the components map (and
// the entire markdown subtree's memoized code blocks) every time results stream in.
export const WebSearchRankMapContext = createContext<Map<
  number,
  WebSearchResult
> | null>(null)

/** A source, as the card of its chip shows it. */
function SourceCard({
  source,
  hidden
}: {
  source: WebSearchResult
  /** Laid out for its height, not shown: another source of the chip is. */
  hidden: boolean
}) {
  return (
    <a
      href={source.link}
      target="_blank"
      rel="noopener noreferrer"
      data-source-card=""
      inert={hidden}
      aria-hidden={hidden || undefined}
      className={cn('col-start-1 row-start-1 block', hidden && 'invisible')}
    >
      {source.thumbnail && (
        <LazyLoadImage
          src={source.thumbnail}
          alt={source.title}
          className="h-32 w-full"
        />
      )}
      <div className="flex flex-col gap-1 p-3">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <SourceFavicon
            link={source.link}
            favicon={source.favicon}
            className="size-3 rounded-full"
          />
          <span className="truncate">{chipLabel([source]).name}</span>
        </div>
        <div className="line-clamp-2 text-sm leading-snug font-semibold">
          {source.title}
        </div>
        {source.snippet && (
          <div className="text-muted-foreground line-clamp-3 text-xs leading-relaxed">
            {removeMd(source.snippet)}
          </div>
        )}
      </div>
    </a>
  )
}

/**
 * Over the card of a chip with several sources: which one is shown, and the
 * way to the next. One source at a time — listed under each other the card
 * grew with every source. Paging is not animated: it is pressed again and
 * again.
 */
function SourcePager({
  index,
  total,
  onChange
}: {
  index: number
  total: number
  onChange: (index: number) => void
}) {
  const { t } = useTranslation('chat')
  return (
    <div className="bg-muted/50 flex items-center gap-0.5 border-b px-1.5 py-1">
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground size-6 [&_svg]:size-3.5"
        aria-label={t('citation.previous')}
        disabled={index === 0}
        onClick={() => onChange(index - 1)}
      >
        <HugeiconsIcon icon={ArrowLeft02Icon} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground size-6 [&_svg]:size-3.5"
        aria-label={t('citation.next')}
        disabled={index === total - 1}
        onClick={() => onChange(index + 1)}
      >
        <HugeiconsIcon icon={ArrowRight01Icon} />
      </Button>
      <span className="text-muted-foreground ml-auto pr-1.5 text-xs tabular-nums">
        {t('citation.position', { current: index + 1, total })}
      </span>
    </div>
  )
}

/**
 * A place the answer cites, as small print: the first source's icon and
 * name, and "+N" for the ones behind it. Quiet on purpose — 9px, muted, a
 * faint pill — so a well-sourced paragraph still reads as a paragraph; the
 * hover card is where the sources are read, one at a time.
 */
const CitationChip = memo(function CitationChip({
  sources
}: {
  sources: WebSearchResult[]
}) {
  const [first] = sources
  const { name, more } = chipLabel(sources)
  // Which source the card shows; the first again once it has closed.
  const [index, setIndex] = useState(0)
  const shown = sources[Math.min(index, sources.length - 1)]

  return (
    <HoverCard onOpenChange={(open) => !open && setIndex(0)}>
      <HoverCardTrigger
        render={
          <a
            href={first.link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={sources.map((s) => chipLabel([s]).name).join(', ')}
            className="group/chip no-underline hover:no-underline"
          />
        }
      >
        {/* The pill is a span of its own: a link inside `.markdown` takes
            the prose's link colour, which is not small print's. Raised 2px:
            its middle on the middle of the line's text, Latin or Han. */}
        <span className="bg-muted text-muted-foreground group-hover/chip:bg-accent group-hover/chip:text-foreground mr-px ml-0.5 inline-flex h-4 max-w-40 items-center gap-[3px] rounded-full pr-1.5 pl-0.5 align-[2px] text-[9px] leading-none font-medium transition-colors duration-150 ease-out select-none">
          <SourceFavicon
            link={first.link}
            favicon={first.favicon}
            className="ring-border size-[11px] rounded-full ring-[0.5px]"
          />
          <span className="truncate">{name}</span>
          {more > 0 && <span className="font-normal">+{more}</span>}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        side="top"
        className="w-72 overflow-hidden rounded-xl border p-0 shadow-lg"
      >
        {sources.length > 1 && (
          <SourcePager
            index={sources.indexOf(shown)}
            total={sources.length}
            onChange={setIndex}
          />
        )}
        {/* Every source in one grid cell, the others out of sight: the card
            is as tall as its tallest source whichever it shows, so the pager
            does not move from under the pointer when a shorter source comes
            (the card closed on the click that paged it). */}
        <div className="grid">
          {sources.map((source) => (
            <SourceCard
              key={source.link}
              source={source}
              hidden={source !== shown}
            />
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
})

/**
 * A place the answer cites, as the syntax tree hands it over: its numbers,
 * and the punctuation that closes the sentence after it. The numbers are
 * looked up here, at render, against the sources the turn may cite — from
 * context, so that results arriving do not rebuild the `components` map. A
 * place no source answers to draws only its punctuation: a bare marker in
 * the prose reads as a rendering bug.
 */
function CitationPlace({ ranks, tail }: { ranks?: string; tail?: string }) {
  const rankMap = useContext(WebSearchRankMapContext)
  const sources = useMemo(
    () =>
      rankMap
        ? sourcesOf(
            (ranks ?? '').split(',').map((n) => Number.parseInt(n, 10)),
            rankMap
          )
        : [],
    [ranks, rankMap]
  )

  if (sources.length === 0) return tail ?? null
  const chip = <CitationChip sources={sources} />
  // The sentence's closing punctuation stays on the chip's line: a chip is
  // a box, a line may break after a box, and no line starts with "。".
  return tail ? (
    <span className="whitespace-nowrap">
      {chip}
      {tail}
    </span>
  ) : (
    chip
  )
}

/** For `Markdown`'s `components`: what draws a citation node. */
// eslint-disable-next-line react-refresh/only-export-components
export const citationComponents = { [CITATION_ELEMENT]: CitationPlace }
