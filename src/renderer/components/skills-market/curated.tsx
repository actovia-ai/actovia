import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type {
  SkillCuratedOwner,
  SkillListItem
} from '@actovia/shared/types/skills'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { useCuratedSkills } from '@/hooks/use-skills-registry'
import { cn } from '@/lib/utils'

import { ExpandToggle, ListCard, LoadFailed, Skeletons } from './leaderboard'
import { Installs, SkillRow, useCompactNumber } from './skill-row'

// A publisher opens to this many of its skills; the rest come on "Show all".
const PREVIEW = 6

function byInstalls(a: { installs: number }, b: { installs: number }) {
  return b.installs - a.installs
}

/**
 * The publishers skills.sh curates — companies and projects maintaining
 * their own skills. One row each; open one for its skills, most installed
 * first, the registry's featured pick marked.
 */
export function CuratedOwners({
  installedSlugs,
  onOpen
}: {
  installedSlugs: Set<string>
  onOpen: (item: SkillListItem) => void
}) {
  const { t } = useTranslation('settings')
  const compact = useCompactNumber()
  const { data, error, isLoading, refetch } = useCuratedSkills()
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [showAll, setShowAll] = useState<Set<string>>(() => new Set())

  const owners = useMemo(
    () =>
      (data?.data ?? [])
        .map((owner) => ({
          ...owner,
          skills: [...owner.skills].sort(byInstalls)
        }))
        .sort((a, b) => b.totalInstalls - a.totalInstalls),
    [data]
  )

  const toggleIn = (
    set: (fn: (prev: Set<string>) => Set<string>) => void,
    key: string
  ) =>
    set((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  if (isLoading) return <Skeletons count={8} />
  if (error || !data) return <LoadFailed onRetry={() => void refetch()} />

  const ownerRow = (owner: SkillCuratedOwner) => {
    const isOpen = open.has(owner.owner)
    const all = showAll.has(owner.owner)
    const shown = all ? owner.skills : owner.skills.slice(0, PREVIEW)
    const hidden = owner.skills.length - shown.length
    return (
      <div key={owner.owner} className="divide-border flex flex-col divide-y">
        <button
          type="button"
          data-testid={TEST_IDS.skillsMarket.curatedOwnerButton}
          aria-expanded={isOpen}
          onClick={() => toggleIn(setOpen, owner.owner)}
          className="hover:bg-muted/40 focus-visible:bg-muted/40 flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors focus-visible:outline-none"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-sm font-medium">{owner.owner}</span>
            <span className="text-muted-foreground truncate text-xs tabular-nums">
              {t('skillsMarket.curated.skillCount', {
                count: owner.skills.length
              })}
              {' · '}
              <Installs count={owner.totalInstalls} />
            </span>
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}

            className={cn(
              'text-muted-foreground size-4 shrink-0 transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </button>
        {isOpen &&
          shown.map((item) => (
            <SkillRow
              key={item.id}
              item={item}
              nested
              installed={installedSlugs.has(item.slug)}
              showActivity={false}
              badge={
                item.slug === owner.featuredSkill ? (
                  <Badge variant="secondary">
                    {t('skillsMarket.curated.featured')}
                  </Badge>
                ) : undefined
              }
              onOpen={onOpen}
            />
          ))}
        {isOpen && (hidden > 0 || all) && (
          <ExpandToggle
            open={all}
            indent="nested"
            onClick={() => toggleIn(setShowAll, owner.owner)}
            label={
              all
                ? t('skillsMarket.curated.showFewer')
                : t('skillsMarket.curated.showAll', { count: hidden })
            }
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground px-1 text-xs tabular-nums">
        {t('skillsMarket.curated.summary', {
          owners: data.totalOwners,
          skills: compact(data.totalSkills)
        })}
      </p>
      <ListCard>{owners.map(ownerRow)}</ListCard>
    </div>
  )
}
