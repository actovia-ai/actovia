import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type {
  DiscoverArticle,
  DiscoverGroup
} from '@actovia/shared/types/discover'
import { getHttpErrorMessage, toErrorI18n } from '@actovia/shared/utils/http'
import { RefreshIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { formatDistanceToNow } from 'date-fns'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LazyLoadImage } from '@/components/markdown/lazy-load-image'
import { SourceFavicon } from '@/components/markdown/source-favicon'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import {
  useDiscoverFeed,
  useRefreshDiscoverFeed
} from '@/hooks/use-discover-feed'
import { useSettings } from '@/hooks/use-settings'
import { cn } from '@/lib/utils'

/**
 * `publishedAt` (ISO) gets a live relative label so a card cached for ~20h
 * doesn't keep saying "2 hours ago". Falls back to Brave's `age` string.
 */
function articleAge(article: DiscoverArticle): string | null {
  if (article.publishedAt) {
    const d = new Date(article.publishedAt)
    if (!Number.isNaN(d.getTime())) {
      return formatDistanceToNow(d, { addSuffix: true })
    }
  }
  return article.age ?? null
}

/**
 * Article thumbnail. An article the feed has no picture for — or whose
 * picture does not load: news-site images regularly 404, hotlink-block, or
 * reject the app's `Referer` — gets no tile at all, and its text takes the
 * row. A column of grey boxes with a faint favicon read as broken images
 * (owner, 2026-10-22).
 */
function DiscoverThumb({ article }: { article: DiscoverArticle }) {
  const [failed, setFailed] = useState(false)
  if (!article.thumbnail || failed) return null
  return (
    <div className="bg-muted relative h-[4.5rem] w-28 shrink-0 overflow-hidden rounded-lg">
      <LazyLoadImage
        src={article.thumbnail}
        alt={article.title}
        referrerPolicy="no-referrer"
        fallback={null}
        onError={() => setFailed(true)}
      />
    </div>
  )
}

/**
 * One article link. Memoised so a state change on `<DiscoverFeed>` (the refresh
 * spinner toggling) doesn't re-render every row — `article` refs are stable
 * across a refresh until the new feed resolves.
 */
const ArticleRow = memo(function ArticleRow({
  article
}: {
  article: DiscoverArticle
}) {
  const age = articleAge(article)
  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group hover:bg-muted/40 -mx-2 flex gap-3.5 rounded-lg px-2 py-3 transition-colors"
    >
      <DiscoverThumb article={article} />
      <div className="min-w-0 flex-1">
        <div className="group-hover:text-foreground/80 line-clamp-2 text-base leading-snug font-medium transition-colors">
          {article.title}
        </div>
        <div className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
          <SourceFavicon
            link={article.url}
            favicon={article.favicon}
            className="size-3.5"
          />
          <span className="truncate">{article.source}</span>
          {age && <span className="shrink-0">· {age}</span>}
        </div>
      </div>
    </a>
  )
})

const TopicSection = memo(function TopicSection({
  group
}: {
  group: DiscoverGroup
}) {
  return (
    <section className="mt-5 first:mt-2">
      <p className="text-muted-foreground text-2xs mb-1 font-semibold tracking-wide uppercase">
        {group.topic}
      </p>
      <div className="flex flex-col">
        {group.articles.map((article) => (
          <ArticleRow key={article.url} article={article} />
        ))}
      </div>
    </section>
  )
})

export function DiscoverFeed() {
  const { t, i18n } = useTranslation(['errors', 'discover'])
  const { data: settings } = useSettings()
  const enabled = settings?.discover?.enabled ?? false
  const { feed } = useDiscoverFeed(enabled)
  const { mutateAsync: refreshFeed } = useRefreshDiscoverFeed()
  const [refreshing, setRefreshing] = useState(false)
  const kickedInitialRefresh = useRef(false)

  // First opt-in: the feed row exists but has never been generated. Kick one
  // refresh so the empty home fills in within seconds instead of waiting for
  // the next 30-minute cron sweep. Only from a clean 'idle' state — a 'failed'
  // first attempt is left for the cron to retry, so navigating home can't
  // hammer the provider.
  useEffect(() => {
    if (kickedInitialRefresh.current) return
    if (!enabled || !feed || feed.generatedAt || feed.status !== 'idle') return
    kickedInitialRefresh.current = true
    void refreshFeed().catch(() => {
      // The feed row records its own failure; nothing actionable here.
    })
  }, [enabled, feed, refreshFeed])

  // Nothing to show until there's at least one group of recommendations —
  // keep the welcome page in its original, uncluttered state otherwise.
  if (!enabled || !feed || feed.groups.length === 0) return null

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshFeed()
    } catch (e) {
      toast.add({
        type: 'error',
        title: t('discover:toast.refreshFailed'),
        description: getHttpErrorMessage(e, toErrorI18n(i18n))
      })
    } finally {
      setRefreshing(false)
    }
  }

  const isBusy = refreshing || feed.status === 'refreshing'
  const updatedAgo =
    feed.generatedAt && !Number.isNaN(new Date(feed.generatedAt).getTime())
      ? formatDistanceToNow(new Date(feed.generatedAt), { addSuffix: true })
      : null

  return (
    <div className="mt-6" data-testid={TEST_IDS.discover.section}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-2xl font-bold tracking-tight">
            {t('discover:heading')}
          </h2>
          {updatedAgo && (
            <span className="text-muted-foreground text-xs">
              {t('discover:updatedAgo', { time: updatedAgo })}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          disabled={isBusy}
          onClick={handleRefresh}
          title={t('discover:refreshButton')}
        >
          <HugeiconsIcon
            icon={RefreshIcon}

            className={cn('size-4', isBusy && 'animate-spin')}
          />
        </Button>
      </div>

      {feed.groups.map((group) => (
        <TopicSection key={group.memoryId} group={group} />
      ))}
    </div>
  )
}
