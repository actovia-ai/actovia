import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { SearchIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsIntro } from '@/components/settings/settings-kit'
import { SettingsSelect } from '@/components/settings/settings-select'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDebouncedValue } from '@/hooks/use-debounce'
import { useInstalledSkills } from '@/hooks/use-installed-skills'
import { useSkillsInfiniteRegistry } from '@/hooks/use-skills-registry'
import { useFormat } from '@/lib/format'

import { CliQuickStart } from './cli-notice'
import { CuratedOwners } from './curated'
import { InstalledSkillsList } from './installed-list'
import { RegistryLeaderboard, SearchResults } from './leaderboard'
import { SkillDetailPage } from './skill-detail'
import { SkillsSourceNoticeText } from './source-notice'
import {
  BROWSE_VIEWS,
  type BrowseView,
  refFromListItem,
  type SkillRef
} from './types'

/** `/` focuses the search unless the user is already typing somewhere. */
function useSlashToFocus(ref: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable)
      )
        return
      e.preventDefault()
      ref.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [ref])
}

export function SkillsMarket() {
  const { t } = useTranslation('settings')
  const { number } = useFormat()
  const [query, setQuery] = useState('')
  const [view, setView] = useState<BrowseView>('all-time')
  const [selected, setSelected] = useState<SkillRef | null>(null)
  const debouncedQuery = useDebouncedValue(query.trim(), 350)
  const searchRef = useRef<HTMLInputElement>(null)
  useSlashToFocus(searchRef)

  const { data: installedList } = useInstalledSkills()
  const installedSlugs = useMemo(
    () => new Set(installedList?.map((s) => s.slug) ?? []),
    [installedList]
  )
  // The registry's total, for the "All time (n)" tab — the same query as the
  // leaderboard's, so it is one request, not two.
  const { data: allTime } = useSkillsInfiniteRegistry('all-time')
  const total = allTime?.pages[0]?.pagination.total

  const viewLabel = (v: BrowseView) => {
    if (v === 'trending') return t('skillsMarket.views.trending')
    if (v === 'hot') return t('skillsMarket.views.hot')
    if (v === 'curated') return t('skillsMarket.views.curated')
    return total === undefined
      ? t('skillsMarket.views.allTime')
      : t('skillsMarket.views.allTimeWithTotal', { total: number(total) })
  }

  if (selected) {
    return <SkillDetailPage item={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className="flex flex-col gap-6">
      {/* One short band, split in half: what the page is on the left, the
          terminal route on the right; stacked when the window is narrow. */}
      <div className="@container -mt-4">
        <div className="grid items-start gap-x-8 gap-y-4 @2xl:grid-cols-2">
          <SettingsIntro className="mt-0">
            <p>
              <SkillsSourceNoticeText />
            </p>
          </SettingsIntro>
          <CliQuickStart />
        </div>
      </div>

      <Tabs defaultValue="discover" className="flex flex-col gap-5">
        <TabsList variant="line">
          <TabsTrigger
            value="discover"
            data-testid={TEST_IDS.skillsMarket.discoverTab}
          >
            {t('skillsMarket.tabs.discover')}
          </TabsTrigger>
          <TabsTrigger
            value="installed"
            data-testid={TEST_IDS.skillsMarket.installedTab}
          >
            {t('skillsMarket.tabs.installed')}
            {installedList?.length ? (
              <span className="text-muted-foreground tabular-nums">
                {installedList.length}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="discover" className="flex flex-col gap-4">
          {/* One row: the search, and the leaderboard it falls back to.
              The board is a choice of list, not a second tab strip under
              the first. */}
          <div className="flex items-center gap-2">
            <InputGroup className="flex-1">
              <InputGroupInput
                ref={searchRef}
                data-testid={TEST_IDS.skillsMarket.searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('skillsMarket.searchPlaceholder')}
              />
              <InputGroupAddon align="inline-start">
                <HugeiconsIcon icon={SearchIcon} />
              </InputGroupAddon>
              <InputGroupAddon align="inline-end">
                <Kbd>{'/'}</Kbd>
              </InputGroupAddon>
            </InputGroup>
            <SettingsSelect
              testId={TEST_IDS.skillsMarket.viewToggle}
              value={view}
              onValueChange={(v) => setView(v as BrowseView)}
              disabled={!!debouncedQuery}
              options={BROWSE_VIEWS.map((v) => ({
                value: v,
                label: viewLabel(v)
              }))}
            />
          </div>

          {debouncedQuery ? (
            <SearchResults
              query={debouncedQuery}
              installedSlugs={installedSlugs}
              onOpen={(item) => setSelected(refFromListItem(item))}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {view === 'curated' ? (
                <CuratedOwners
                  installedSlugs={installedSlugs}
                  onOpen={(item) => setSelected(refFromListItem(item))}
                />
              ) : (
                <RegistryLeaderboard
                  view={view}
                  installedSlugs={installedSlugs}
                  onOpen={(item) => setSelected(refFromListItem(item))}
                />
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="installed">
          <InstalledSkillsList onOpen={setSelected} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
