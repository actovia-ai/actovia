import { faviconUrl } from '@actovia/shared/constants/external-urls'
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type {
  ChatToolResultMessage,
  TimelineStep
} from '@actovia/shared/types/chat'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import {
  AiBrainIcon,
  Tick02Icon,
  ArrowDown01Icon,
  Globe02Icon,
  MessageSquareTextIcon,
  CircleCheckBigIcon,
  ClockFadingIcon,
  CancelCircleIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { capitalCase } from 'change-case'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MODE_FRAMES,
  type ModeFrame,
  resolvePreset,
  ThinkingOrb
} from 'thinking-orbs'

import { i18n } from '@/lib/i18n'
import { ROW_ENTER } from '@/lib/motion'
import { cn } from '@/lib/utils'

import { foldedFileName, terminalExitCode } from '../calling-tools/folded-tools'
import { Markdown } from '../markdown/markdown'
import { ShimmeringText } from '../motion/shimmering-text'
import { Badge } from '../ui/badge'
import { MessageCallingTools } from './messages-calling-tools'

export type { TimelineStep }

interface ThinkingTimelineProps {
  /** For the cards folded under a row. */
  chatId: string
  steps: TimelineStep[]
  durationMs: number
  isStreaming: boolean
}

type StepStatus = 'complete' | 'active' | 'pending'

/**
 * What the header's icon is: the moving orb only while this turn's thinking
 * is in flight; once it is over, a still one (or a check when the run only
 * worked, never thought). A settled turn must not look like it is loading.
 */
export type HeaderIcon = 'live' | 'resting' | 'done'

export function headerIcon(
  isStreaming: boolean,
  hasThinking: boolean
): HeaderIcon {
  if (isStreaming) return 'live'
  return hasThinking ? 'resting' : 'done'
}

// The settled orb holds one representative pose: the frame the library itself
// paints under prefers-reduced-motion, rather than wherever the clock was.
const RESTING_MODE = resolvePreset('solving', 20).mode
const RESTING_FRAME: ModeFrame = (size, _t, opts) =>
  MODE_FRAMES[RESTING_MODE](size, 0.6, opts)

// Matches AI SDK Elements' chain-of-thought status grading: the step in flight
// reads at full strength, settled steps recede.
const STATUS_TEXT: Record<StepStatus, string> = {
  complete: 'text-muted-foreground',
  active: 'text-foreground',
  pending: 'text-muted-foreground/50'
}

function StepIcon({
  step,
  status
}: {
  step: TimelineStep
  status: StepStatus
}) {
  if (step.type === 'toolResult' && step.isError) {
    return (
      <HugeiconsIcon
        icon={CancelCircleIcon}

        size={15}
        className="text-destructive shrink-0"
      />
    )
  }
  const cls = cn('shrink-0', STATUS_TEXT[status])
  if (step.toolName === TOOL_NAMES.webSearch)
    return (
      <HugeiconsIcon
        icon={Globe02Icon}

        size={15}
        className={cls}
      />
    )
  if (step.type === 'thinking')
    return (
      <HugeiconsIcon
        icon={AiBrainIcon}

        size={15}
        className={cls}
      />
    )
  if (step.type === 'narration')
    return (
      <HugeiconsIcon
        icon={MessageSquareTextIcon}

        size={15}
        className={cls}
      />
    )
  return (
    <HugeiconsIcon
      icon={ClockFadingIcon}

      size={15}
      className={cls}
    />
  )
}

const SearchResultPill = memo(function SearchResultPill({
  item
}: {
  item: WebSearchResult
}) {
  let favicon = ''
  try {
    favicon = faviconUrl(new URL(item.link).origin)
  } catch {
    // no favicon — the label still renders
  }

  return (
    <Badge
      variant="outline"
      className="max-w-[14rem] gap-1 font-normal"
      render={
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          title={item.title}
        />
      }
    >
      {favicon && (
        <img src={favicon} alt="" className="size-3 shrink-0 rounded-full" />
      )}
      <span className="truncate">{item.title}</span>
    </Badge>
  )
})

/**
 * The card of a tool whose result folds into the timeline (a command run, a
 * file written): closed under its row — the exit code or the file's name on
 * a small toggle — and the full card once opened.
 */
function FoldedCard({
  chatId,
  step,
  isStreaming
}: {
  chatId: string
  step: TimelineStep & { toolResult: ChatToolResultMessage }
  isStreaming: boolean
}) {
  const { t } = useTranslation('chat')
  const [open, setOpen] = useState(false)
  const terminal = step.toolName === TOOL_NAMES.terminal
  const exitCode = terminal ? terminalExitCode(step.toolResult) : null
  const label = terminal
    ? exitCode === null
      ? capitalCase(step.toolName ?? '')
      : t('terminalCard.exitCode', { code: exitCode })
    : (foldedFileName(step.toolResult) ?? step.toolName)
  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="text-muted-foreground hover:text-foreground -ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs transition-colors"
      >
        <HugeiconsIcon
          icon={ArrowDown01Icon}

          size={13}
          className={cn('shrink-0 transition-transform', !open && '-rotate-90')}
        />
        <span
          className={cn(
            // Success is the quiet default; only a failure takes a colour.
            exitCode !== null && exitCode !== 0 && 'text-destructive'
          )}
        >
          {label}
        </span>
      </button>
      {open && (
        <MessageCallingTools
          chatId={chatId}
          toolResult={step.toolResult}
          isStreaming={isStreaming}
          className="mt-1 w-full"
        />
      )}
    </div>
  )
}

function TimelineNode({
  icon,
  isLast,
  children
}: {
  icon: React.ReactNode
  isLast?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn(ROW_ENTER, 'flex gap-2.5 pb-3 last:pb-0')}>
      <div className="mt-1 flex flex-col items-center">
        <div className="flex shrink-0 items-center justify-center">{icon}</div>
        {!isLast && <div className="border-border w-px flex-1 border-l" />}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/**
 * A plain helper (not a component or hook) — translated text goes through
 * the shared `i18n` singleton directly, matching `getToolCallPreview` in
 * `messages.tsx`.
 */
function formatDuration(ms: number): string | null {
  // Message timestamps mark stream START, not END (see pi-ai providers), so
  // sub-second durations are unreliable — drop them rather than show "0 seconds".
  if (!Number.isFinite(ms) || ms < 1000) return null
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) {
    return i18n.t('chat:thinkingTimeline.durationSeconds', { count: seconds })
  }
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return remaining > 0
    ? i18n.t('chat:thinkingTimeline.durationMinutesSeconds', {
        minutes,
        seconds: remaining
      })
    : i18n.t('chat:thinkingTimeline.durationMinutes', { minutes })
}

/** Extract a short title from a step for the collapsed preview */
function getStepTitle(step: TimelineStep): string {
  if (step.type === 'toolCall') return step.text
  if (step.type === 'toolResult' && step.webSearchResults) {
    return i18n.t('chat:thinkingTimeline.searchResultCount', {
      count: step.webSearchResults.length
    })
  }
  if (step.type === 'toolResult' && step.isError) return step.text
  // thinking: extract **bold** or first line
  const boldMatch = step.text.match(/\*\*(.+?)\*\*/)
  if (boldMatch) return boldMatch[1]
  return (
    step.text.split('\n').filter(Boolean)[0]?.slice(0, 60) ??
    i18n.t('chat:thinkingTimeline.thinking')
  )
}

export function ThinkingTimeline({
  chatId,
  steps,
  durationMs,
  isStreaming
}: ThinkingTimelineProps) {
  const { t } = useTranslation('chat')
  const [isExpanded, setIsExpanded] = useState(false)
  const toggleExpanded = useCallback(() => setIsExpanded((prev) => !prev), [])

  const hasThinking = useMemo(
    () => steps.some((s) => s.type === 'thinking'),
    [steps]
  )

  const latestTitle = useMemo(() => {
    if (steps.length === 0)
      return hasThinking
        ? t('thinkingTimeline.thinking')
        : t('thinkingTimeline.working')
    return getStepTitle(steps.at(-1) as TimelineStep)
  }, [steps, hasThinking, t])

  if (steps.length === 0 && !isStreaming) return null

  const verb = hasThinking
    ? t('thinkingTimeline.thought')
    : t('thinkingTimeline.worked')
  const duration = formatDuration(durationMs)
  const headerText = isStreaming
    ? latestTitle
    : duration
      ? t('thinkingTimeline.thoughtFor', { verb, duration })
      : verb
  const icon = headerIcon(isStreaming, hasThinking)

  return (
    // min-w-0 lets the timeline shrink inside flex parents instead of pushing
    // them wider when a tool-call URL or path is long. max-w-full clamps it
    // to the ancestor (e.g. md:max-w-3xl) regardless of intrinsic content.
    <div className="mb-3 max-w-full min-w-0">
      <button
        type="button"
        aria-expanded={isExpanded}
        className="text-muted-foreground hover:text-foreground flex max-w-full items-center gap-1.5 overflow-hidden text-sm transition-colors"
        onClick={toggleExpanded}
      >
        {icon === 'live' ? (
          <ThinkingOrb state="working" size={20} className="shrink-0" />
        ) : icon === 'resting' ? (
          <ThinkingOrb
            state="solving"
            size={20}
            paused
            frame={RESTING_FRAME}
            aria-hidden
            className="shrink-0"
          />
        ) : (
          <HugeiconsIcon
            icon={Tick02Icon}

            size={16}
            className="shrink-0"
          />
        )}
        {isStreaming ? (
          <ShimmeringText
            key={headerText}
            className="truncate font-medium"
            text={headerText}
          />
        ) : (
          <span className="truncate font-medium">{headerText}</span>
        )}
        <HugeiconsIcon
          icon={ArrowDown01Icon}

          size={16}
          className={cn(
            'shrink-0 transition-transform duration-200',
            isExpanded && 'rotate-180'
          )}
        />
      </button>

      {/* CSS grid-rows trick: animates height:auto with zero JS (replaces the
          old framer-motion AnimatePresence). Content stays mounted so the
          per-step slide-in animations only fire once, on first appearance. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
          isExpanded
            ? 'grid-rows-[1fr] opacity-100'
            : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <div className="mt-2">
            {/* react-doctor/no-array-index-as-key: suppressed — TimelineStep has no
              stable id field. Steps are append-only during streaming (they never
              reorder or get removed while visible), so index keys are safe here. */}
            {steps.map((step, i) => {
              const status: StepStatus = isStreaming
                ? i === steps.length - 1
                  ? 'active'
                  : 'complete'
                : 'complete'
              return (
                <TimelineNode
                  key={i}
                  icon={<StepIcon step={step} status={status} />}
                >
                  <div
                    className={cn(
                      // min-w-0 break-words: tool-call previews like
                      // "webFetch: https://…/long-url.pdf" must wrap mid-URL
                      // instead of overflowing the timeline.
                      'min-w-0 text-sm leading-relaxed wrap-break-word [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_h4]:text-sm [&_ol]:my-0.5 [&_ul]:my-0.5 [&_p:first-child]:mt-0 [&_p]:my-0.5',
                      STATUS_TEXT[status],
                      step.type === 'toolResult' &&
                        step.isError &&
                        'text-destructive'
                    )}
                  >
                    {/* Narration is a sentence the model said while working:
                        drawn as the other rows are, not as Markdown, whose
                        paragraph size and colour would stand it apart. */}
                    {step.type === 'thinking' ? (
                      <Markdown src={step.text} />
                    ) : (
                      <>
                        <p className="wrap-break-word">{step.text}</p>
                        {step.codeArgument && (
                          <pre className="bg-muted/50 border-border/60 mt-1 max-h-48 overflow-auto rounded-md border p-2 font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap">
                            <code>{step.codeArgument}</code>
                          </pre>
                        )}
                        {step.toolResult && (
                          <FoldedCard
                            chatId={chatId}
                            step={{ ...step, toolResult: step.toolResult }}
                            isStreaming={isStreaming}
                          />
                        )}
                      </>
                    )}
                  </div>

                  {step.webSearchResults &&
                    step.webSearchResults.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {step.webSearchResults.map((result) => (
                          <SearchResultPill key={result.link} item={result} />
                        ))}
                      </div>
                    )}
                </TimelineNode>
              )
            })}

            {/* Done node — only when streaming is finished */}
            {!isStreaming && (
              <TimelineNode
                isLast
                icon={
                  <HugeiconsIcon
                    icon={CircleCheckBigIcon}

                    size={15}
                    className="text-muted-foreground shrink-0"
                  />
                }
              >
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {t('thinkingTimeline.done')}
                </p>
              </TimelineNode>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
