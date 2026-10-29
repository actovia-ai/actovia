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
  Globe02Icon,
  MessageSquareTextIcon,
  CommandLineIcon,
  FileEditIcon,
  FileSearchIcon,
  FolderOpenIcon,
  Link01Icon,
  Wrench01Icon,
  CancelCircleIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MODE_FRAMES,
  type ModeFrame,
  resolvePreset,
  ThinkingOrb
} from 'thinking-orbs'

import { FAVICON_BACKING } from '@/components/markdown/source-favicon'
import { i18n } from '@/lib/i18n'
import { ROW_ENTER } from '@/lib/motion'
import { toolLabel } from '@/lib/tool-label'
import { cn } from '@/lib/utils'

import { foldedFileName, terminalExitCode } from '../calling-tools/folded-tools'
import { Markdown } from '../markdown/markdown'
import { Badge } from '../ui/badge'
import { CodeBlock, CodeBlockContent } from '../ui/code-block'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle
} from '../ui/trace'
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

/** What a call did, drawn on its row — a clock read as still waiting once it was done. */
const TOOL_ICON: Record<string, IconSvgElement> = {
  [TOOL_NAMES.terminal]: CommandLineIcon,
  [TOOL_NAMES.writeFile]: FileEditIcon,
  [TOOL_NAMES.editFile]: FileEditIcon,
  [TOOL_NAMES.readFile]: FileSearchIcon,
  [TOOL_NAMES.grep]: FileSearchIcon,
  [TOOL_NAMES.findFiles]: FolderOpenIcon,
  [TOOL_NAMES.listDirectory]: FolderOpenIcon,
  [TOOL_NAMES.webFetch]: Link01Icon
}

function StepIcon({ step }: { step: TimelineStep }) {
  const icon =
    step.type === 'toolResult' && step.isError
      ? CancelCircleIcon
      : step.toolName === TOOL_NAMES.webSearch
        ? Globe02Icon
        : step.type === 'thinking'
          ? AiBrainIcon
          : step.type === 'narration'
            ? MessageSquareTextIcon
            : (TOOL_ICON[step.toolName ?? ''] ?? Wrench01Icon)
  return (
    <TraceIcon className="mt-0.5">
      <HugeiconsIcon icon={icon} strokeWidth={2} />
    </TraceIcon>
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
        <img
          src={favicon}
          alt=""
          className={cn('size-3 shrink-0 rounded-full', FAVICON_BACKING)}
        />
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
      ? toolLabel(step.toolName ?? '')
      : t('terminalCard.exitCode', { code: exitCode })
    : (foldedFileName(step.toolResult) ?? step.toolName)
  const failed = exitCode !== null && exitCode !== 0
  return (
    <TraceCollapsible open={open} onOpenChange={setOpen} className="mt-1">
      <TraceCollapsibleTrigger>
        {/* Success is the quiet default; only a failure takes a colour. */}
        <TraceLine status={failed ? 'error' : undefined} className="text-xs">
          <TraceTitle>{label}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="mt-1 ml-0 border-l-0 pl-0">
        <MessageCallingTools
          chatId={chatId}
          toolResult={step.toolResult}
          isStreaming={isStreaming}
          className="w-full"
        />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

/** One step of the chain: its icon, then what it was — wrapping, never cut. */
function TimelineStepRow({
  step,
  status,
  children
}: {
  step: TimelineStep
  status: StepStatus
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        ROW_ENTER,
        'flex min-w-0 gap-2',
        STATUS_TEXT[status],
        step.type === 'toolResult' && step.isError && 'text-destructive'
      )}
    >
      <StepIcon step={step} />
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

  // AI Elements' chain of thought, on shadcn's Trace: the header is one line
  // that opens on the steps, each a line of its own under the rule the
  // content draws. min-w-0 / max-w-full keep a long URL or path from pushing
  // the turn wider than its column.
  return (
    <Trace className="mb-3 max-w-full min-w-0">
      <TraceCollapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <TraceCollapsibleTrigger>
          <TraceLine status={isStreaming ? 'running' : undefined}>
            {/* The orb draws at 20px only; the check sits in the same box. */}
            <TraceIcon className="size-5">
              {icon === 'live' ? (
                <ThinkingOrb state="working" size={20} />
              ) : icon === 'resting' ? (
                <ThinkingOrb
                  state="solving"
                  size={20}
                  paused
                  frame={RESTING_FRAME}
                  aria-hidden
                />
              ) : (
                <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
              )}
            </TraceIcon>
            <TraceTitle className="font-medium">{headerText}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        {/* Kept mounted, so each step's entrance plays once, when it arrives,
            not every time the chain is opened. */}
        <TraceCollapsibleContent keepMounted className="flex flex-col gap-3">
          {/* react-doctor/no-array-index-as-key: suppressed — TimelineStep has no
              stable id field. Steps are append-only during streaming (they never
              reorder or get removed while visible), so index keys are safe here. */}
          {steps.map((step, i) => {
            const status: StepStatus =
              isStreaming && i === steps.length - 1 ? 'active' : 'complete'
            return (
              <TimelineStepRow key={i} step={step} status={status}>
                <div className="min-w-0 text-sm leading-relaxed wrap-break-word [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_h4]:text-sm [&_ol]:my-0.5 [&_p]:my-0.5 [&_p:first-child]:mt-0 [&_ul]:my-0.5">
                  {/* Narration is a sentence the model said while working:
                      drawn as the other rows are, not as Markdown, whose
                      paragraph size and colour would stand it apart. */}
                  {step.type === 'thinking' ? (
                    <Markdown src={step.text} />
                  ) : (
                    <>
                      <p className="wrap-break-word">{step.text}</p>
                      {step.codeArgument && (
                        <CodeBlock size="sm" className="mt-1">
                          <CodeBlockContent wrap className="max-h-48">
                            {step.codeArgument}
                          </CodeBlockContent>
                        </CodeBlock>
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

                {step.webSearchResults && step.webSearchResults.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {step.webSearchResults.map((result) => (
                      <SearchResultPill key={result.link} item={result} />
                    ))}
                  </div>
                )}
              </TimelineStepRow>
            )
          })}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
