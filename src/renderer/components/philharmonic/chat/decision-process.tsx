import { TEST_IDS } from '@exodus/shared/constants/test-ids'
import { CLI_IDS, CLI_NAMES, type CliId } from '@exodus/shared/types/agents'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { TFunction } from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Reveal } from '@/components/motion/morph'
import { usePmRound } from '@/hooks/use-pm-round'
import { useFormat } from '@/lib/format'
import {
  describeRound,
  roundCounts,
  waitRefusalReason,
  wakeTimeOf,
  type RoundLine
} from '@/lib/pm-round'
import { cn } from '@/lib/utils'

/** What the round recorder stores for a report whose employee it could not name. */
const STORED_PLACEHOLDER = 'former employee'

type Counts = { delegations: number; waits: number }
type CallLine = Extract<RoundLine, { kind: 'call' }>

/** What the disclosure needs of an employee: its name, and for a CLI one the CLI and model. */
export interface DecisionAgent {
  name: string
  runtime: string
  model: string | null
}

const STEP_STATUSES = [
  'pending',
  'running',
  'done',
  'skipped',
  'failed'
] as const
type StepStatus = (typeof STEP_STATUSES)[number]
const isCliRuntime = (runtime: string): runtime is CliId =>
  (CLI_IDS as readonly string[]).includes(runtime)
const isStepStatus = (v: string): v is StepStatus =>
  (STEP_STATUSES as readonly string[]).includes(v)

export interface DecisionProcessProps {
  conversationId: string
  roundId: string
  /** The PM message's own text: a final text equal to it is not repeated. */
  bubbleText: string
  /** The message's `{ kind: 'decision' }` part. */
  counts?: Counts
  agentOf(agentId: string): DecisionAgent | undefined
  onJumpTo(messageId: string): void
}

const Chevron = ({ open }: { open: boolean }) => (
  <HugeiconsIcon
    icon={ArrowDown01Icon}
    className={cn(
      'h-3 w-3 shrink-0 transition-transform duration-200 ease-out',
      !open && '-rotate-90'
    )}
  />
)

const asString = (v: unknown) => (typeof v === 'string' ? v : '')

function callSentence(
  line: CallLine,
  t: TFunction<'philharmonic'>,
  employee: (id: string) => string,
  delegate: (id: string) => string
): string {
  const a = line.args
  switch (line.tool) {
    case 'delegateTask': {
      const id = asString(a.employeeId)
      return line.refused
        ? t('chat.decision.refused', { name: employee(id) })
        : t('chat.decision.delegate', { who: delegate(id) })
    }
    case 'waitForQuota': {
      if (line.refused)
        return t('chat.decision.waitRefused', {
          reason: waitRefusalReason(line.result)
        })
      const wait = t('chat.decision.wait', {
        name: employee(asString(a.employeeId)),
        reason: asString(a.reason)
      })
      const at = wakeTimeOf(line.result)
      return at ? `${wait} · ${t('chat.decision.wakeAt', { time: at })}` : wait
    }
    case 'createPlan':
      return t('chat.decision.plan', {
        count: Array.isArray(a.steps) ? a.steps.length : 0
      })
    case 'updatePlanStep': {
      const status = asString(a.status)
      return t('chat.decision.updateStep', {
        status: isStepStatus(status)
          ? t(`chat.decision.status.${status}`)
          : status
      })
    }
    case 'appendPlanStep':
      return t('chat.decision.appendStep')
    case 'recruitEmployee':
      return t('chat.decision.recruit', {
        name: asString(a.name) || asString(a.role)
      })
    case 'createReport':
      return t('chat.decision.report')
    case 'askUser':
      return t('chat.decision.askUser')
    case 'search_knowledge_base':
      return t('chat.decision.search')
    default:
      return t('chat.decision.otherTool', { tool: line.tool })
  }
}

/** A row that folds something longer under it (thinking, a call's details). */
function Folded({
  label,
  className,
  children
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  // Mounted on first open, then kept: a long thinking block or a call's
  // arguments cost nothing until asked for, and folding still animates.
  const [opened, setOpened] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => {
          setOpened(true)
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        className={cn(
          'hover:text-foreground flex items-center gap-1 self-start text-left',
          className
        )}
      >
        <Chevron open={open} />
        {label}
      </button>
      <Reveal open={open}>{opened ? children : null}</Reveal>
    </div>
  )
}

const Pre = ({ children }: { children: React.ReactNode }) => (
  <pre className="bg-muted text-foreground max-h-60 overflow-auto rounded-md px-2 py-1.5 font-mono text-xs break-all whitespace-pre-wrap">
    {children}
  </pre>
)

function Line({
  line,
  agentOf,
  onJumpTo
}: {
  line: RoundLine
  agentOf: (agentId: string) => DecisionAgent | undefined
  onJumpTo: (messageId: string) => void
}) {
  const { t } = useTranslation('philharmonic')
  const fmt = useFormat()
  const nameOf = (id: string) => agentOf(id)?.name
  const employee = (id: string) =>
    nameOf(id) ?? t('chat.decision.formerEmployee')
  // "Name · CLI · model" for a coding-agent CLI, the name alone otherwise.
  const delegate = (id: string) => {
    const agent = agentOf(id)
    if (!agent) return t('chat.decision.formerEmployee')
    if (!isCliRuntime(agent.runtime)) return agent.name
    return [
      agent.name,
      CLI_NAMES[agent.runtime],
      agent.model ?? t('chat.decision.cliDefault')
    ].join(' · ')
  }

  switch (line.kind) {
    case 'trigger':
      return (
        <div className="flex flex-col">
          <span className="text-foreground">
            {line.scheduled
              ? t('chat.decision.triggerScheduled')
              : t('chat.decision.triggerUser')}
          </span>
          <span className="line-clamp-2">{line.text}</span>
        </div>
      )
    case 'reports':
      return (
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span>{t('chat.decision.reports')}</span>
          {line.reports.map((r) => {
            const stored = r.name && r.name !== STORED_PLACEHOLDER ? r : null
            const name =
              (r.agentId ? nameOf(r.agentId) : undefined) ??
              stored?.name ??
              t('chat.decision.formerEmployee')
            return (
              <button
                key={r.messageId}
                type="button"
                onClick={() => onJumpTo(r.messageId)}
                className="text-primary-ink hover:underline"
              >
                {name}
              </button>
            )
          })}
        </div>
      )
    case 'thinking':
      return (
        <Folded label={t('chat.decision.thinking')}>
          <Pre>{line.text}</Pre>
        </Folded>
      )
    case 'text':
      return <p className="text-foreground whitespace-pre-wrap">{line.text}</p>
    case 'call':
      return (
        <div
          className={cn(
            'flex flex-col gap-0.5',
            line.isError && 'text-destructive'
          )}
        >
          <span className={cn(!line.isError && 'text-foreground')}>
            {callSentence(line, t, employee, delegate)}
            {line.isError && ` · ${t('chat.decision.failed')}`}
          </span>
          {line.tool === 'delegateTask' &&
            !line.refused &&
            asString(line.args.instructions) && (
              <span className="truncate">
                {asString(line.args.instructions)}
              </span>
            )}
          <Folded label={t('chat.decision.details')}>
            <div className="flex flex-col gap-1">
              <Pre>{JSON.stringify(line.args, null, 2)}</Pre>
              {line.result !== null && <Pre>{line.result}</Pre>}
            </div>
          </Folded>
        </div>
      )
    case 'usage':
      return (
        <span>
          {t('chat.decision.usage', {
            input: fmt.number(line.inputTokens),
            output: fmt.number(line.outputTokens),
            cost: fmt.number(line.costUsd, { maximumFractionDigits: 4 })
          })}
        </span>
      )
    case 'error':
      return (
        <span className="text-destructive">
          {line.aborted
            ? t('chat.decision.interrupted')
            : t('chat.decision.error', { message: line.message })}
        </span>
      )
  }
}

/**
 * Under a PM message: how it decided — what started the round, the reports
 * it read, its thinking, every call with its arguments and result, usage.
 * Nothing is fetched until it is opened.
 */
export function DecisionProcess({
  conversationId,
  roundId,
  bubbleText,
  counts,
  agentOf,
  onJumpTo
}: DecisionProcessProps) {
  const { t } = useTranslation('philharmonic')
  const [open, setOpen] = useState(false)
  const { data, isError, isPending } = usePmRound(conversationId, roundId, open)
  const lines = useMemo(
    () => (data ? describeRound(data, bubbleText) : []),
    [data, bubbleText]
  )
  const shown = counts ?? (data ? roundCounts(data) : undefined)
  const label = [
    t('chat.decision.toggle'),
    shown?.delegations
      ? t('chat.decision.delegations', { count: shown.delegations })
      : null,
    shown?.waits ? t('chat.decision.waits', { count: shown.waits }) : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-1 px-0.5">
      <button
        type="button"
        data-testid={TEST_IDS.philharmonic.decisionToggle}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-xs"
      >
        <Chevron open={open} />
        {label}
      </button>
      <Reveal open={open}>
        <div className="text-muted-foreground border-border ml-1.5 flex flex-col gap-1.5 border-l py-1 pl-3 text-xs">
          {isError ? (
            <span>{t('chat.decision.unavailable')}</span>
          ) : isPending ? (
            <span>{t('chat.decision.loading')}</span>
          ) : (
            lines.map((line, i) => (
              <Line key={i} line={line} agentOf={agentOf} onJumpTo={onJumpTo} />
            ))
          )}
        </div>
      </Reveal>
    </div>
  )
}
