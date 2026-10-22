import { faviconUrl } from '@actovia/shared/constants/external-urls'
import { WebSearchResult } from '@actovia/shared/types/web-search'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { plainText } from '@/lib/plain-text'
import { cn } from '@/lib/utils'

import { parseCitations } from '../markdown/markdown-citations'
import { FAVICON_BACKING } from '../markdown/source-favicon'

function SourceItemLink({
  item,
  compact
}: {
  item: WebSearchResult
  compact?: boolean
}) {
  let hostname = ''
  let favicon = ''
  try {
    const url = new URL(item.link)
    hostname = url.hostname
    favicon = faviconUrl(url.origin)
  } catch {
    hostname = item.link
  }

  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'hover:bg-sidebar-accent flex min-w-0 gap-3',
        compact ? '-mx-1.5 rounded-md px-1.5 py-1' : 'rounded-xl px-3 py-2'
      )}
    >
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'leading-snug',
            compact
              ? 'truncate text-xs'
              : 'line-clamp-2 text-sm font-semibold break-words'
          )}
        >
          {item.title}
        </div>
        <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
          {favicon && (
            <Avatar className={cn('size-3.5', FAVICON_BACKING)}>
              <AvatarImage
                src={favicon}
                alt={hostname}
                className="object-cover"
              />
              <AvatarFallback>{item.title?.charAt(0)}</AvatarFallback>
            </Avatar>
          )}
          <span className="truncate">{hostname}</span>
        </div>
        {!compact && item.snippet ? (
          <div className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-snug">
            {plainText(item.snippet)}
          </div>
        ) : null}
      </div>
    </a>
  )
}

export function SourceItem({
  webSearchResults,
  finalReport,
  compact
}: {
  finalReport?: string
  webSearchResults: WebSearchResult[]
  /** A step of the Activity timeline: title and site on one line each, no snippet. */
  compact?: boolean
}) {
  const { t } = useTranslation('deepResearch')
  const citedRanks = useMemo(() => {
    if (!finalReport) return new Set<number>()
    return new Set(parseCitations(finalReport) ?? [])
  }, [finalReport])

  const cited = webSearchResults.filter((r) => citedRanks.has(r.rank))
  const more = webSearchResults.filter((r) => !citedRanks.has(r.rank))

  if (citedRanks.size === 0) {
    return (
      <div className="flex flex-col gap-1">
        {webSearchResults.map((item) => (
          <SourceItemLink key={item.link} item={item} compact={compact} />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="mb-0! ml-3 font-bold">{t('sources.citations')}</p>
      {cited.map((item) => (
        <SourceItemLink key={item.link} item={item} />
      ))}
      {more.length > 0 && (
        <>
          <Separator className="mt-3" />
          <p className="mt-3 mb-0! ml-3 font-bold">{t('sources.more')}</p>
          {more.map((item) => (
            <SourceItemLink key={item.link} item={item} />
          ))}
        </>
      )}
    </div>
  )
}
