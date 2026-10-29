import type { PlanDto, StepStatus } from '@actovia/shared/types/philharmonic'
import {
  ArrowRight01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  DashedLineCircleIcon,
  Loading03Icon,
  MinusSignCircleIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import { i18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { AgentData } from '@/stores/philharmonic'

import { EmployeeAvatar } from '../employees/employee-avatar'

interface Props {
  plan: PlanDto
  agentsById: Record<string, AgentData>
}

// A step's state as AI Elements' Queue draws one (ISSUE-293): an outlined
// glyph in the theme's colours — never a palette colour or an emoji.
const STATUS_ICON = {
  pending: DashedLineCircleIcon,
  running: Loading03Icon,
  done: CheckmarkCircle02Icon,
  skipped: MinusSignCircleIcon,
  failed: CancelCircleIcon
} satisfies Record<StepStatus, unknown>

const STATUS_TONE: Record<StepStatus, string> = {
  pending: 'text-muted-foreground/60',
  running: 'text-foreground animate-spin [animation-duration:1.6s]',
  done: 'text-muted-foreground',
  skipped: 'text-muted-foreground/60',
  failed: 'text-destructive'
}

function elapsedLabel(plan: PlanDto): string {
  const start = new Date(plan.createdAt).getTime()
  const end =
    plan.status === 'completed' || plan.status === 'aborted'
      ? new Date(plan.updatedAt).getTime()
      : Date.now()
  const min = Math.floor((end - start) / 60_000)
  if (min < 1) return i18n.t('philharmonic:chat.planCard.elapsed.lessThanMin')
  if (min < 60)
    return i18n.t('philharmonic:chat.planCard.elapsed.minutes', { count: min })
  return i18n.t('philharmonic:chat.planCard.elapsed.hoursMinutes', {
    hours: Math.floor(min / 60),
    minutes: min % 60
  })
}

export function PlanCard({ plan, agentsById }: Props) {
  const { t } = useTranslation('philharmonic')
  const stepStatusAria: Record<StepStatus, string> = useMemo(
    () => ({
      pending: t('chat.planCard.stepStatusAria.pending'),
      running: t('chat.planCard.stepStatusAria.running'),
      done: t('chat.planCard.stepStatusAria.done'),
      skipped: t('chat.planCard.stepStatusAria.skipped'),
      failed: t('chat.planCard.stepStatusAria.failed')
    }),
    [t]
  )
  // Auto-collapse completed plans and busy plans with > 4 steps.
  const initialCollapsed =
    plan.status === 'completed' ||
    plan.status === 'aborted' ||
    plan.steps.length > 4
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  // Tick once a minute so elapsed labels stay fresh without an animation loop.
  const [, force] = useState(0)
  useEffect(() => {
    if (plan.status !== 'active') return
    const timer = setInterval(() => force((n) => n + 1), 60_000)
    return () => clearInterval(timer)
  }, [plan.status])

  if (plan.steps.length === 0) return null

  const done = plan.steps.filter((s) => s.status === 'done').length
  const total = plan.steps.length

  return (
    <Collapsible
      open={!collapsed}
      onOpenChange={(open) => setCollapsed(!open)}
      className="bg-muted mb-4 overflow-hidden rounded-2xl"
    >
      <CollapsibleTrigger className="group/plan focus-visible:ring-ring/50 flex w-full items-center gap-2 px-4 py-3 text-left outline-none focus-visible:ring-3">
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className="text-muted-foreground size-4 shrink-0 transition-transform duration-200 ease-out group-aria-expanded/plan:rotate-90"
        />
        <span className="text-foreground text-ui flex-1 truncate font-medium">
          {plan.summary}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {done}/{total} · {elapsedLabel(plan)}
        </span>
        <StatusPill status={plan.status} />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
        <ol className="flex flex-col gap-0.5 px-2 pb-2">
          {plan.steps.map((s) => {
            const agent = s.assignedAgentId
              ? agentsById[s.assignedAgentId]
              : undefined
            return (
              <li
                key={s.id}
                data-status={s.status}
                className={cn(
                  'flex items-start gap-3 rounded-xl px-2 py-2',
                  s.status === 'running' && 'bg-background'
                )}
              >
                <span
                  className="mt-px inline-flex size-4 shrink-0 items-center justify-center"
                  aria-label={stepStatusAria[s.status]}
                >
                  <HugeiconsIcon
                    icon={STATUS_ICON[s.status]}
                    strokeWidth={2}
                    className={cn('size-4', STATUS_TONE[s.status])}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'text-ui',
                      s.status === 'done' &&
                        'text-muted-foreground line-through decoration-muted-foreground/40',
                      s.status === 'skipped' && 'text-muted-foreground',
                      s.status === 'running' && 'text-foreground shimmer',
                      (s.status === 'pending' || s.status === 'failed') &&
                        'text-foreground'
                    )}
                  >
                    {s.title}
                  </div>
                  {s.intent && (
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      {s.intent}
                    </div>
                  )}
                  {s.output && s.status === 'done' && (
                    <div className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                      {s.output}
                    </div>
                  )}
                  {s.note && (
                    <div className="text-warning mt-1 text-xs">{s.note}</div>
                  )}
                </div>
                {agent && (
                  <EmployeeAvatar
                    seed={agent.avatarSeed}
                    style={agent.avatarStyle}
                    size={24}
                  />
                )}
              </li>
            )
          })}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}

function StatusPill({ status }: { status: PlanDto['status'] }) {
  const { t } = useTranslation('philharmonic')
  const label =
    status === 'active'
      ? t('chat.planCard.status.active')
      : status === 'completed'
        ? t('chat.planCard.status.done')
        : status === 'aborted'
          ? t('chat.planCard.status.aborted')
          : t('chat.planCard.status.draft')
  // A chip on a muted card: the page's colour under a hairline.
  return (
    <span
      className={cn(
        'bg-background ring-border rounded-full px-2 py-0.5 text-2xs font-medium ring-1',
        status === 'aborted' ? 'text-destructive' : 'text-muted-foreground'
      )}
    >
      {label}
    </span>
  )
}
