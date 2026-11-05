import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { LibraryItem } from '@actovia/shared/types/library'
import { SearchIcon, SparklesIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { WorkspaceFilePreview } from '@/components/calling-tools/workspace-file/workspace-file-preview'
import { LibraryPreview } from '@/components/library/library-preview'
import {
  ReportThumbnail,
  ResearchReportPreview
} from '@/components/library/report-preview'
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
import { useLibraryItems } from '@/hooks/use-library'
import { useFormat } from '@/lib/format'
import { ENTER_UP, staggerDelay } from '@/lib/motion'
import type { SearchReveal } from '@/lib/reveal-search-hit'
import { cn } from '@/lib/utils'

/**
 * The Library page (ISSUE-237): every item the chats made, newest
 * first. A card opens its chat at the card that drew it — the same reveal
 * Search chats uses, with no words to mark and the call's id to land on.
 */
export function Library() {
  const { t } = useTranslation('chat')
  const { data, isPending } = useLibraryItems()
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
      data-testid={TEST_IDS.library.page}
    >
      <div className="mx-auto w-full max-w-5xl px-8 pt-6 pb-12">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-medium tracking-tight">
              {t('library.title')}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('library.description')}
            </p>
          </div>
          {(data?.length ?? 0) > 0 && (
            <InputGroup className="w-64">
              <InputGroupInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('library.searchPlaceholder')}
                data-testid={TEST_IDS.library.search}
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
                  ? t('library.noMatches', { query: query.trim() })
                  : t('library.emptyTitle')}
              </EmptyTitle>
              {!query && (
                <EmptyDescription>
                  {t('library.emptyDescription')}
                </EmptyDescription>
              )}
            </EmptyHeader>
          </Empty>
        ) : (
          <Grid>
            {shown.map((item, i) => (
              <LibraryCard key={item.artifactId} item={item} index={i} />
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

function LibraryCard({ item, index }: { item: LibraryItem; index: number }) {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const format = useFormat()
  const [previewing, setPreviewing] = useState(false)
  const title = item.title || t('library.untitled')

  const open = () => {
    if (item.kind) {
      setPreviewing(true)
      return
    }
    const reveal: SearchReveal = {
      runId: item.runId,
      role: 'assistant',
      words: [],
      toolCallId: item.toolCallId
    }
    navigate(`/chat/${item.chatId}`, { state: reveal })
  }

  // The entrance's delay sits on a wrapper: on the button it would hold back
  // every hover and press transition too.
  return (
    <div
      className={cn(index < 12 && ENTER_UP)}
      style={index < 12 ? staggerDelay(index) : undefined}
    >
      {/* The preview is a frame, which a button may not hold: the button is
          the title's, stretched over the whole card by its ::after. */}
      <div className="group bg-background ring-border/70 hover:ring-border has-[:focus-visible]:ring-ring relative flex flex-col overflow-hidden rounded-xl ring-1 transition-[box-shadow,transform] duration-150 ease-out hover:shadow-sm has-[:active]:scale-[0.99] has-[:focus-visible]:ring-2">
        {item.kind ? (
          <ReportThumbnail item={item} />
        ) : (
          <LibraryPreview
            chatId={item.chatId}
            artifactId={item.artifactId}
            title={title}
          />
        )}
        <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
          <button
            type="button"
            onClick={open}
            data-testid={TEST_IDS.library.card}
            className="truncate text-left text-sm font-medium outline-none after:absolute after:inset-0"
            title={title}
          >
            {title}
          </button>
          <span className="text-muted-foreground truncate text-xs">
            {item.chatTitle} · {format.relativeTime(new Date(item.createdAt))}
          </span>
        </div>
      </div>
      {previewing && item.kind === 'workspace-file' && item.path && (
        <WorkspaceFilePreview
          path={item.path}
          chatId={item.chatId}
          open
          onOpenChange={setPreviewing}
        />
      )}
      {previewing && item.kind === 'research' && (
        <ResearchReportPreview
          item={item}
          onClose={() => setPreviewing(false)}
        />
      )}
    </div>
  )
}
