import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { SkillListItem } from '@actovia/shared/types/skills'
import { Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type React from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useFormat } from '@/lib/format'
import { cn } from '@/lib/utils'

export function useCompactNumber() {
  const { number } = useFormat()
  return (n: number) =>
    number(n, { notation: 'compact', maximumFractionDigits: 1 })
}

/**
 * "3.5M installs", the word muted and — with `emphasis` — the number in the
 * foreground. One catalog key with the number in `<n>`, because the word
 * comes before the number in Korean; `tests/unit/i18n/settings-namespace.test.ts`
 * renders this component.
 */
export function Installs({
  count,
  emphasis
}: {
  count: number
  emphasis?: boolean
}) {
  const compact = useCompactNumber()
  return (
    <span className="text-muted-foreground tabular-nums">
      <Trans
        ns="settings"
        i18nKey="skillsMarket.card.installs"
        values={{ formatted: compact(count) }}
        components={{
          n: <span className={cn(emphasis && 'text-foreground')} />
        }}
      />
    </span>
  )
}

/** Already in ~/.actovia/skills — green, the audit panel's "pass" colour. */
export function InstalledBadge() {
  const { t } = useTranslation('settings')
  return (
    <Badge
      variant="secondary"
      className="shrink-0 bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
    >
      <HugeiconsIcon icon={Tick02Icon} />
      {t('skillsMarket.card.installedBadge')}
    </Badge>
  )
}

/** Width of the rank column, so names line up whether ranked or not. */
const RANK_COL = 'w-6 shrink-0 text-right'

export function SkillRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="h-3 w-4" />
      <Skeleton className="h-3.5 w-1/3" />
      <Skeleton className="ml-auto h-3.5 w-16" />
    </div>
  )
}

/**
 * One skill in a list, on one line: its rank (on a leaderboard), name and
 * source, then installs on the right. The whole row opens the detail page.
 */
export function SkillRow({
  item,
  rank,
  installed,
  showActivity,
  badge,
  nested,
  onOpen
}: {
  item: SkillListItem
  /** Position on a leaderboard; absent in search results and under a publisher. */
  rank?: number
  installed: boolean
  /** Hot / Trending views carry a daily delta worth showing. */
  showActivity: boolean
  /** Something to say about this row in its list — "Featured". */
  badge?: React.ReactNode
  /** Under a publisher's row: indented to its text. */
  nested?: boolean
  onOpen: (item: SkillListItem) => void
}) {
  const { t } = useTranslation('settings')
  const compact = useCompactNumber()
  const delta = showActivity && item.change && item.change > 0 ? item.change : 0

  return (
    <button
      type="button"
      data-testid={TEST_IDS.skillsMarket.row}
      onClick={() => onOpen(item)}
      className={cn(
        'hover:bg-muted/40 focus-visible:bg-muted/40 flex w-full items-center gap-3 py-2.5 pr-4 text-left transition-colors focus-visible:outline-none',
        nested ? 'pl-8' : 'pl-4'
      )}
    >
      {rank !== undefined && (
        <span
          className={cn(RANK_COL, 'text-muted-foreground text-sm tabular-nums')}
        >
          {rank}
        </span>
      )}
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium">{item.name}</span>
        <span className="text-muted-foreground truncate text-xs">
          {item.source}
        </span>
        {installed && <InstalledBadge />}
        {badge}
      </span>
      <span className="flex shrink-0 items-baseline gap-2 text-sm">
        <Installs count={item.installs} emphasis />
        {delta > 0 && (
          <span className="text-muted-foreground text-xs">
            {t('skillsMarket.card.trend', { formatted: compact(delta) })}
          </span>
        )}
      </span>
    </button>
  )
}
