import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { ArtifactListItem } from '@actovia/shared/types/artifact-list'
import { SearchIcon, SparklesIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { useAllArtifacts } from '@/hooks/use-artifacts'
import { useFormat } from '@/lib/format'
import { ENTER_UP, staggerDelay } from '@/lib/motion'
import type { SearchReveal } from '@/lib/reveal-search-hit'
import { cn } from '@/lib/utils'

/**
 * The Artifacts page (ISSUE-237): every artifact the chats made, newest
 * first. A card opens its chat at the run that made it — the same reveal
 * Search chats uses, with no words to mark — where the card draws it.
 */
export function Artifacts() {
  const { t } = useTranslation('chat')
  const { data, isPending } = useAllArtifacts()
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    if (!q) return data ?? []
    return (data ?? []).filter(
      (a) =>
        a.title.toLocaleLowerCase().includes(q) ||
        a.chatTitle.toLocaleLowerCase().includes(q)
    )
  }, [data, query])

  return (
    <div
      className="relative min-h-0 flex-1 overflow-y-auto"
      data-testid={TEST_IDS.artifacts.page}
    >
      <div className="mx-auto w-full max-w-5xl px-8 pt-6 pb-12">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-medium tracking-tight">
              {t('artifacts.title')}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('artifacts.description')}
            </p>
          </div>
          {(data?.length ?? 0) > 0 && (
            <InputGroup className="w-64">
              <InputGroupInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('artifacts.searchPlaceholder')}
                data-testid={TEST_IDS.artifacts.search}
              />
              <InputGroupAddon align="inline-start">
                <HugeiconsIcon icon={SearchIcon} />
              </InputGroupAddon>
            </InputGroup>
          )}
        </div>

        {isPending ? (
          <Grid>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-52 rounded-xl" />
            ))}
          </Grid>
        ) : shown.length === 0 ? (
          <Empty className="py-24">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={SparklesIcon} />
              </EmptyMedia>
              <EmptyTitle>
                {query
                  ? t('artifacts.noMatches', { query: query.trim() })
                  : t('artifacts.emptyTitle')}
              </EmptyTitle>
              {!query && (
                <EmptyDescription>
                  {t('artifacts.emptyDescription')}
                </EmptyDescription>
              )}
            </EmptyHeader>
          </Empty>
        ) : (
          <Grid>
            {shown.map((artifact, i) => (
              <ArtifactCard
                key={artifact.artifactId}
                artifact={artifact}
                index={i}
              />
            ))}
          </Grid>
        )}
      </div>
    </div>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
      {children}
    </div>
  )
}

function ArtifactCard({
  artifact,
  index
}: {
  artifact: ArtifactListItem
  index: number
}) {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const format = useFormat()
  const title = artifact.title || t('artifacts.untitled')

  const open = () => {
    const reveal: SearchReveal = {
      runId: artifact.runId,
      role: 'assistant',
      words: []
    }
    navigate(`/chat/${artifact.chatId}`, { state: reveal })
  }

  // The entrance's delay sits on a wrapper: on the button it would hold back
  // every hover and press transition too.
  return (
    <div
      className={cn(index < 12 && ENTER_UP)}
      style={index < 12 ? staggerDelay(index) : undefined}
    >
      <button
        type="button"
        onClick={open}
        data-testid={TEST_IDS.artifacts.card}
        className="group bg-background ring-border/70 hover:ring-border focus-visible:ring-ring flex w-full flex-col overflow-hidden rounded-xl text-left ring-1 transition-[box-shadow,transform] duration-150 ease-out outline-none hover:shadow-sm focus-visible:ring-2 active:scale-[0.99]"
      >
        <div className="bg-muted text-muted-foreground flex aspect-[16/9] items-center justify-center">
          <HugeiconsIcon
            icon={SparklesIcon}
            className="size-8 opacity-60 transition-opacity duration-150 group-hover:opacity-90"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
          <span className="truncate text-sm font-medium" title={title}>
            {title}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            {artifact.chatTitle} ·{' '}
            {format.relativeTime(new Date(artifact.createdAt))}
          </span>
        </div>
      </button>
    </div>
  )
}
