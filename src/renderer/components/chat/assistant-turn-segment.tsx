import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AssistantTurn, TurnBlock } from '@actovia/shared/types/chat'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { memo, type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ENTER } from '@/lib/motion'
import { toolLabel } from '@/lib/tool-label'
import { cn } from '@/lib/utils'

import { ErrorBoundary, RenderFailed } from '../app/card-error-boundary'
import { ArtifactDraft } from '../calling-tools/artifact/artifact-card'
import { ImageGenerationCard } from '../calling-tools/image-generation/image-generation-card'
import Markdown from '../markdown/markdown'
import { ImageGallery } from '../web-search/image-gallery'
import { searchMedia } from '../web-search/search-media'
import { VideoCards } from '../web-search/video-cards'
import {
  InteractiveTurnContext,
  TurnTextAboveContext,
  turnTextsAbove,
  useInteractiveTurn
} from './interactive/interactive-context'
import { MemoryChangeStrip } from './memory-change-strip'
import { MessageAction } from './message-action'
import { MessageCallingTools } from './messages-calling-tools'
import { RunApprovals } from './run-approvals'
import { ThinkingTimeline } from './thinking-timeline'
import { UsedMemories } from './used-memories'

export type AssistantTurnSegmentProps = {
  chatId: string
  turn: AssistantTurn
  // All web-search sources seen in the chat up to and including this turn.
  // Citations (【N-source】) can reference searches run in earlier turns, so
  // badge resolution must use this cumulative set, not just the turn's own
  // results. Built in chat order, so the rank map ends up last-wins for the
  // rare case where a later turn re-runs a search with reset numbering.
  citationSources?: WebSearchResult[]
  isStreaming: boolean
  /** Absent for an answer that is not in the conversation (the folded one). */
  regenerate?: () => void
  /** The provider's error, when this run ended in one. */
  error?: string
  /** A reply to a message sent during this visit: it fades in under the dots. */
  fresh: boolean
  /**
   * A last line of the run's foot (a regenerate group's "1 other version").
   * Compared by identity: hand in the same node while nothing changed.
   */
  foot?: ReactNode
  /**
   * Whether a questionnaire or confirmation in this answer can be answered:
   * not while it is compared with another, nor in the version not kept.
   */
  answerable?: boolean
}

/**
 * One block of a turn. Every frame of a streaming run hands each block a new
 * object, so what holds a settled block still is below this: `Markdown` is
 * memoized on its text and sources, a card on its result.
 */
function TurnBlockView({
  block,
  chatId,
  runId,
  citationResults,
  isStreaming
}: {
  block: TurnBlock
  chatId: string
  runId: string
  citationResults?: WebSearchResult[]
  isStreaming: boolean
}) {
  const content = turnBlockContent({
    block,
    chatId,
    runId,
    citationResults,
    isStreaming
  })
  // A block keeps its distance from the one above it: text ends without a
  // margin of its own, so a card under it would sit against the last line.
  // (Under a card the two margins collapse into the card's own.)
  return content && <div className="not-first:mt-4">{content}</div>
}

function turnBlockContent({
  block,
  chatId,
  runId,
  citationResults,
  isStreaming
}: {
  block: TurnBlock
  chatId: string
  runId: string
  citationResults?: WebSearchResult[]
  isStreaming: boolean
}) {
  if (block.kind === 'text') {
    return (
      <ErrorBoundary
        scope="markdown"
        attributes={{ runId }}
        // The words are still worth reading when the markup is not.
        fallback={
          <pre className="font-sans whitespace-pre-wrap">{block.text}</pre>
        }
      >
        <Markdown src={block.text} webSearchResults={citationResults} />
      </ErrorBoundary>
    )
  }

  if (block.kind === 'media') {
    return <SearchMedia results={block.results} shown={block.shown} />
  }

  if (block.kind === 'image') {
    // A call still waiting for its result is forming only while the run
    // streams; in a run that was stopped it never will, so it shows nothing.
    if (!block.result && !isStreaming) return null
    return (
      <ErrorBoundary
        scope="tool-card"
        attributes={{
          toolName: TOOL_NAMES.imageGeneration,
          toolCallId: block.key
        }}
        fallback={<RenderFailed what={toolLabel(TOOL_NAMES.imageGeneration)} />}
      >
        <ImageGenerationCard prompt={block.prompt} result={block.result} />
      </ErrorBoundary>
    )
  }

  // The card is drawn from the tool's answer; until then its place is held —
  // by the artifact's code being written, while the run streams.
  if (!block.result) {
    if (!block.draft || !isStreaming) return null
    return (
      <section className="mb-4 w-full">
        <ArtifactDraft title={block.draft.title} code={block.draft.code} />
      </section>
    )
  }
  return (
    <ErrorBoundary
      scope="tool-card"
      attributes={{ toolName: block.toolName, toolCallId: block.key }}
      fallback={<RenderFailed what={toolLabel(block.toolName)} />}
    >
      <MessageCallingTools
        chatId={chatId}
        toolResult={block.result}
        isStreaming={isStreaming}
      />
    </ErrorBoundary>
  )
}

/**
 * A search's pictures and videos, where it was made in the run. Memoized on
 * the stored results and a string, so it sits out the frames of the text
 * streaming under it.
 */
const SearchMedia = memo(function SearchMedia({
  results,
  shown
}: {
  results: WebSearchResult[]
  shown: string
}) {
  const { images, videos } = useMemo(
    () => searchMedia(results, shown),
    [results, shown]
  )
  return (
    <>
      {images.length > 0 && <ImageGallery images={images} />}
      {videos.length > 0 && <VideoCards videos={videos} />}
    </>
  )
})

/**
 * One run's answer: its timeline, its blocks in run order, one action bar and
 * the run's foot. Also what each column of a comparison is drawn with.
 */
export const AssistantTurnSegment = memo(
  function AssistantTurnSegment({
    chatId,
    turn,
    citationSources,
    isStreaming,
    regenerate,
    error,
    fresh,
    foot,
    answerable = true
  }: AssistantTurnSegmentProps) {
    const { t } = useTranslation('chat')
    // The turn's own searches drive the per-turn "Sources" panel; the
    // cumulative set drives inline citation badges.
    const ownSources =
      turn.webSearchResults.length > 0 ? turn.webSearchResults : undefined
    const citationResults =
      citationSources && citationSources.length > 0
        ? citationSources
        : undefined
    // The run's questionnaire or confirmation: the first one of its whole
    // answer, so one in a later paragraph stays code.
    const interactiveTurn = useInteractiveTurn(
      turn.runId,
      turn.body,
      answerable
    )
    // A later text block's copy of the block is code (by position, not text).
    const textsAbove = turnTextsAbove(turn.blocks)

    return (
      <div
        data-run-id={turn.runId}
        className={cn(
          'mb-8 flex flex-col items-start last:mb-4',
          fresh && ENTER
        )}
      >
        <div className="w-full min-w-0">
          {(turn.steps.length > 0 || isStreaming) && (
            <ThinkingTimeline
              chatId={chatId}
              steps={turn.steps}
              durationMs={turn.durationMs}
              isStreaming={isStreaming && turn.body.length === 0}
            />
          )}

          {/* One run, one answer: the model's text and the cards of the tools
              it called, in the order the run produced them — the text after
              a tool step is the next paragraph, not the next message — with
              one action bar. */}
          <InteractiveTurnContext.Provider value={interactiveTurn}>
            <section className="group relative" data-askable="">
              {turn.blocks.map((block, i) => (
                <TurnTextAboveContext.Provider
                  key={block.key}
                  value={textsAbove[i]}
                >
                  <TurnBlockView
                    block={block}
                    chatId={chatId}
                    runId={turn.runId}
                    citationResults={citationResults}
                    isStreaming={isStreaming}
                  />
                </TurnTextAboveContext.Provider>
              ))}
              {error && (
                <p role="alert" className="text-destructive mt-3 text-sm">
                  {t('run.error', { message: error })}
                </p>
              )}
            </section>
          </InteractiveTurnContext.Provider>

          {/* The run's foot, over its action row as on the phone: a tool call
              waiting for the user's approval, and the run's memory (which
              entries it read, what it changed) — here rather than in the
              timeline, which folds when the run ends. Each renders nothing
              when there is nothing to say (`empty:`). The action row closes
              the turn. */}
          <div className="mt-3 flex flex-col gap-2 empty:hidden">
            <RunApprovals
              chatId={chatId}
              runId={turn.runId}
              active={isStreaming}
            />
            <UsedMemories chatId={chatId} runId={turn.runId} />
            <MemoryChangeStrip messages={turn.messages} active={isStreaming} />
          </div>
          {turn.body.length > 0 && (
            <MessageAction
              regenerate={regenerate}
              content={turn.body}
              webSearchResults={ownSources}
              citationSources={citationResults}
              timestamp={turn.timestamp}
              runId={turn.runId}
            />
          )}
          {foot && <div className="mt-2">{foot}</div>}
        </div>
      </div>
    )
  },
  // During streaming, only the active turn changes — older turns rebuild structurally
  // equal `turn` objects each token. Skip them by checking message references.
  function arePropsEqual(
    prev: AssistantTurnSegmentProps,
    next: AssistantTurnSegmentProps
  ) {
    if (
      prev.chatId !== next.chatId ||
      prev.isStreaming !== next.isStreaming ||
      prev.regenerate !== next.regenerate ||
      prev.citationSources !== next.citationSources ||
      prev.error !== next.error ||
      prev.fresh !== next.fresh ||
      prev.foot !== next.foot ||
      prev.answerable !== next.answerable
    ) {
      return false
    }
    const prevMsgs = prev.turn.messages
    const nextMsgs = next.turn.messages
    if (prevMsgs.length !== nextMsgs.length) return false
    for (let i = 0; i < prevMsgs.length; i++) {
      if (prevMsgs[i] !== nextMsgs[i]) return false
    }
    return true
  }
)
