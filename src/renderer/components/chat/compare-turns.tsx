import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type {
  AssistantTurn,
  CompareSegment,
  RunError
} from '@actovia/shared/types/chat'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { memo, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMinWidth } from '@/hooks/use-min-width'

import { AssistantTurnSegment } from './assistant-turn-segment'
import { OtherVersionDialog } from './other-version-dialog'

/** Two answers fit side by side from here up; below, one at a time. */
const SIDE_BY_SIDE_MIN_WIDTH = 880

/**
 * Where a group stands while its answers are compared, question included: as
 * wide as the chat allows (the scroll area is the query container, `cqw`),
 * centred on the reading column it is in.
 */
export const COMPARE_FRAME =
  'relative left-1/2 w-[max(100%,min(100cqw,72rem))] -translate-x-1/2'

type CompareTurnsProps = {
  chatId: string
  segment: CompareSegment
  /** Per answer, the sources its citations resolve against. */
  citationSources: Map<AssistantTurn, WebSearchResult[]>
  /** The run in flight is this group's newest answer. */
  streaming: boolean
  /** Absent unless this group is the chat's last question: only that one can be asked again. */
  regenerate?: () => void
  choose: (runId: string) => void
  runError?: RunError | null
  /** The messages the chat opened with: what is not among them is fresh. */
  opened: ReadonlySet<string>
  /** Whether the chosen answer shows its "1 other version" link (see below). */
  showsOtherVersion?: boolean
}

/**
 * "1 other version" under a chosen answer. Hidden for now (owner,
 * 2026-09-30, on both platforms); the groups, the choice, the choose route
 * and the dialog all still work — this only decides whether the link is
 * drawn.
 */
export const SHOWS_OTHER_VERSION = false

/**
 * A regenerate group's answers (spec 2026-09-26). While two are compared:
 * side by side where there is room (the list gives the group
 * `COMPARE_FRAME`) and behind tabs where there is not, each with "Use this
 * one". Once one was chosen it is an answer like any other, with a quiet
 * link to the other at its foot.
 *
 * Each answer is an `AssistantTurnSegment`, so cards, citations, the memory
 * foot and approvals are what they are everywhere else.
 */
export const CompareTurns = memo(function CompareTurns(
  props: CompareTurnsProps
) {
  return props.segment.columns.length > 1 ? (
    <Comparing {...props} />
  ) : (
    <Settled {...props} />
  )
}, sameComparison)

function Comparing({
  chatId,
  segment,
  citationSources,
  streaming,
  regenerate,
  choose,
  runError,
  opened
}: CompareTurnsProps) {
  const { t } = useTranslation('chat')
  const frame = useRef<HTMLDivElement>(null)
  const sideBySide = useMinWidth(frame, SIDE_BY_SIDE_MIN_WIDTH)
  const newest = segment.columns.at(-1)!.runId
  const [picked, setPicked] = useState<string | null>(null)
  // The tab on show: the one the user picked, while it is still an answer of
  // the comparison; else the newest — the one being written.
  const active =
    picked && segment.columns.some((turn) => turn.runId === picked)
      ? picked
      : newest

  const answer = (turn: AssistantTurn) => (
    <AssistantTurnSegment
      chatId={chatId}
      turn={turn}
      citationSources={citationSources.get(turn)}
      isStreaming={streaming && turn.runId === newest}
      regenerate={regenerate}
      fresh={!opened.has(turn.runId)}
      error={runError?.runId === turn.runId ? runError.message : undefined}
      // Its block is answered once this answer is kept.
      answerable={false}
    />
  )
  const useThis = (runId: string) => (
    <Button
      variant="secondary"
      size="sm"
      data-testid={TEST_IDS.chat.compare.useThis}
      onClick={() => choose(runId)}
    >
      {t('compare.useThis')}
    </Button>
  )

  return (
    <div ref={frame} className="mb-8 last:mb-4">
      {sideBySide ? (
        <div className="grid grid-cols-2 gap-4">
          {segment.columns.map((turn, index) => (
            <section
              key={turn.runId}
              aria-label={t('compare.answerTab', { n: index + 1 })}
              className="border-border/60 bg-card min-w-0 rounded-2xl border px-5 pt-3 pb-1"
            >
              <header className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-muted-foreground text-xs font-medium">
                  {t('compare.answerTab', { n: index + 1 })}
                </h3>
                {useThis(turn.runId)}
              </header>
              {answer(turn)}
            </section>
          ))}
        </div>
      ) : (
        <Tabs value={active} onValueChange={setPicked}>
          <div className="flex items-center justify-between gap-3">
            <TabsList aria-label={t('compare.tabsLabel')}>
              {segment.columns.map((turn, index) => (
                <TabsTrigger
                  key={turn.runId}
                  value={turn.runId}
                  className="px-3"
                  data-testid={TEST_IDS.chat.compare.tab}
                >
                  {t('compare.answerTab', { n: index + 1 })}
                </TabsTrigger>
              ))}
            </TabsList>
            {useThis(active)}
          </div>
          {segment.columns.map((turn) => (
            <TabsContent
              key={turn.runId}
              value={turn.runId}
              className="text-sm"
            >
              {answer(turn)}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
}

function Settled({
  chatId,
  segment,
  citationSources,
  streaming,
  regenerate,
  choose,
  runError,
  opened,
  showsOtherVersion = SHOWS_OTHER_VERSION
}: CompareTurnsProps) {
  const { t } = useTranslation('chat')
  const [open, setOpen] = useState(false)
  const [turn] = segment.columns
  const folded = showsOtherVersion ? segment.folded : null

  // One node while nothing changed: the answer is memoized on it.
  const foot = useMemo(
    () =>
      folded && (
        <Button
          variant="link"
          size="xs"
          className="text-muted-foreground hover:text-foreground h-auto self-start px-0"
          data-testid={TEST_IDS.chat.compare.otherVersionLink}
          onClick={() => setOpen(true)}
        >
          {t('compare.otherVersion', { count: 1 })}
        </Button>
      ),
    [folded, t]
  )

  return (
    <>
      <AssistantTurnSegment
        chatId={chatId}
        turn={turn}
        citationSources={citationSources.get(turn)}
        isStreaming={streaming}
        regenerate={regenerate}
        fresh={!opened.has(turn.runId)}
        error={runError?.runId === turn.runId ? runError.message : undefined}
        foot={foot}
      />
      {folded && (
        <OtherVersionDialog
          open={open}
          onOpenChange={setOpen}
          chatId={chatId}
          turn={folded}
          citationSources={citationSources.get(folded)}
          locked={segment.locked}
          onUseInstead={() => {
            choose(folded.runId)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

/**
 * A settled comparison sits out the frames of a run that streams below it:
 * the list hands every segment a new sources map per frame, so what is
 * compared is what this group reads from it.
 */
function sameComparison(prev: CompareTurnsProps, next: CompareTurnsProps) {
  if (
    prev.segment !== next.segment ||
    prev.chatId !== next.chatId ||
    prev.streaming !== next.streaming ||
    prev.regenerate !== next.regenerate ||
    prev.choose !== next.choose ||
    prev.opened !== next.opened
  ) {
    return false
  }
  const runs = [...next.segment.columns, next.segment.folded]
  for (const turn of runs) {
    if (!turn) continue
    if (prev.citationSources.get(turn) !== next.citationSources.get(turn)) {
      return false
    }
    if (errorOf(prev.runError, turn) !== errorOf(next.runError, turn)) {
      return false
    }
  }
  return true
}

function errorOf(runError: RunError | null | undefined, turn: AssistantTurn) {
  return runError?.runId === turn.runId ? runError.message : undefined
}
