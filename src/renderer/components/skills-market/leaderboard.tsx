import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { SkillListItem, SkillsView } from '@actovia/shared/types/skills'
import {
  ArrowDown01Icon,
  Loading03Icon,
  SearchRemoveIcon,
  UnplugIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsEmpty } from '@/components/settings/settings-kit'
import { SettingsSection } from '@/components/settings/settings-row'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  useSkillsInfiniteRegistry,
  useSkillsSearch
} from '@/hooks/use-skills-registry'
import { cn } from '@/lib/utils'

import { SkillRow, SkillRowSkeleton, useCompactNumber } from './skill-row'

const SKELETONS = Array.from({ length: 8 }, (_, i) => i)

interface Ranked {
  item: SkillListItem
  rank: number
}

/**
 * Consecutive rows from one repo collapse behind the first one, the way
 * skills.sh's leaderboard does — a hot repo can otherwise fill a whole page
 * with near-identical entries. Ranks stay global (1, 2, +3 more, 6, …).
 */
interface RowGroup {
  head: Ranked
  rest: Ranked[]
  total: number
}

function groupBySource(items: SkillListItem[], collapse: boolean): RowGroup[] {
  const groups: RowGroup[] = []
  items.forEach((item, i) => {
    const ranked = { item, rank: i + 1 }
    const last = groups.at(-1)
    if (collapse && last && last.head.item.source === item.source) {
      last.rest.push(ranked)
      last.total += item.installs
    } else {
      groups.push({ head: ranked, rest: [], total: item.installs })
    }
  })
  return groups
}

export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <SettingsSection>
      <SettingsEmpty
        icon={UnplugIcon}
        title={t('skillsMarket.browse.loadFailed')}
        description={t('skillsMarket.browse.loadFailedHint')}
      >
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('common:action.retry')}
        </Button>
      </SettingsEmpty>
    </SettingsSection>
  )
}

/** The list card every browse view is drawn in: rows with hairlines. */
export function ListCard({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card className={cn('divide-border gap-0 divide-y py-0', className)}>
      {children}
    </Card>
  )
}

export function Skeletons({ count }: { count: number }) {
  return (
    <ListCard>
      {SKELETONS.slice(0, count).map((i) => (
        <SkillRowSkeleton key={i} />
      ))}
    </ListCard>
  )
}

/** A "show more / show fewer" line under a row, lined up with its text. */
export function ExpandToggle({
  open,
  label,
  indent,
  testId,
  onClick
}: {
  open: boolean
  label: string
  /** Where the rows above start their text. */
  indent: 'ranked' | 'nested'
  testId?: string
  onClick: () => void
}) {
  return (
    <div className={cn('py-2', indent === 'ranked' ? 'pl-13' : 'pl-8')}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        data-testid={testId}
        aria-expanded={open}
        className="text-muted-foreground -ml-2.5"
        onClick={onClick}
      >
        {label}
        <HugeiconsIcon
          icon={ArrowDown01Icon}

          className={cn(
            'transition-transform duration-200',
            open && 'rotate-180'
          )}
        />
      </Button>
    </div>
  )
}

export function LeaderboardTable({
  items,
  installedSlugs,
  showActivity,
  collapseSources,
  onOpen
}: {
  items: SkillListItem[]
  installedSlugs: Set<string>
  showActivity: boolean
  collapseSources: boolean
  onOpen: (item: SkillListItem) => void
}) {
  const { t } = useTranslation('settings')
  const compact = useCompactNumber()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const groups = useMemo(
    () => groupBySource(items, collapseSources),
    [items, collapseSources]
  )

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const row = ({ item, rank }: Ranked) => (
    <SkillRow
      key={item.id}
      item={item}
      rank={rank}
      installed={installedSlugs.has(item.slug)}
      showActivity={showActivity}
      onOpen={onOpen}
    />
  )

  return (
    <ListCard>
      {groups.map((group) => {
        const id = group.head.item.id
        const open = expanded.has(id)
        return (
          <div key={id} className="divide-border flex flex-col divide-y">
            {row(group.head)}
            {open && group.rest.map(row)}
            {group.rest.length > 0 && (
              <ExpandToggle
                open={open}
                indent="ranked"
                testId={TEST_IDS.skillsMarket.expandGroupButton}
                onClick={() => toggle(id)}
                label={
                  open
                    ? t('skillsMarket.browse.lessFromSource', {
                        source: group.head.item.source
                      })
                    : t('skillsMarket.browse.moreFromSource', {
                        count: group.rest.length,
                        source: group.head.item.source,
                        total: compact(group.total)
                      })
                }
              />
            )}
          </div>
        )
      })}
    </ListCard>
  )
}

export function SearchResults({
  query,
  installedSlugs,
  onOpen
}: {
  query: string
  installedSlugs: Set<string>
  onOpen: (item: SkillListItem) => void
}) {
  const { t } = useTranslation('settings')
  const { data, error, isLoading, refetch } = useSkillsSearch(query)

  if (isLoading) return <Skeletons count={5} />
  if (error) return <LoadFailed onRetry={() => void refetch()} />
  if (!data || data.data.length === 0) {
    return (
      <SettingsSection>
        <SettingsEmpty
          icon={SearchRemoveIcon}
          title={t('skillsMarket.browse.noResults', { query })}
          description={t('skillsMarket.browse.noResultsHint')}
        />
      </SettingsSection>
    )
  }
  return (
    <SettingsSection
      title={t('skillsMarket.browse.resultCount', { count: data.data.length })}
      plain
    >
      <LeaderboardTable
        items={data.data}
        installedSlugs={installedSlugs}
        showActivity={false}
        collapseSources={false}
        onOpen={onOpen}
      />
    </SettingsSection>
  )
}

export function RegistryLeaderboard({
  view,
  installedSlugs,
  onOpen
}: {
  view: SkillsView
  installedSlugs: Set<string>
  onOpen: (item: SkillListItem) => void
}) {
  const { t } = useTranslation('settings')
  const {
    data,
    error,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch
  } = useSkillsInfiniteRegistry(view)

  const items = useMemo(() => {
    const seen = new Set<string>()
    const out: SkillListItem[] = []
    for (const page of data?.pages ?? []) {
      for (const item of page.data) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        out.push(item)
      }
    }
    return out
  }, [data])

  if (isLoading) return <Skeletons count={8} />
  if (error && items.length === 0) {
    return <LoadFailed onRetry={() => void refetch()} />
  }
  if (items.length === 0) {
    return (
      <SettingsSection>
        <SettingsEmpty
          icon={SearchRemoveIcon}
          title={t('skillsMarket.browse.empty')}
        />
      </SettingsSection>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <LeaderboardTable
        items={items}
        installedSlugs={installedSlugs}
        showActivity={view !== 'all-time'}
        collapseSources
        onOpen={onOpen}
      />
      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            data-testid={TEST_IDS.skillsMarket.loadMoreButton}
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage && (
              <HugeiconsIcon
                icon={Loading03Icon}

                className="animate-spin"
              />
            )}
            {t('skillsMarket.browse.loadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}
