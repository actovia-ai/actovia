import type { PlanDto, StepStatus } from '@actovia/shared/types/philharmonic'
import {
  Tick02Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { i18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { AgentData } from '@/stores/philharmonic'

import { EmployeeAvatar } from '../employees/employee-avatar'

interface Props {
  plan: PlanDto
  agentsById: Record<string, AgentData>
}

const STATUS_GLYPH: Record<StepStatus, string> = {
  pending: '○',
  running: '⏳',
  done: '✓',
  skipped: '⊘',
  failed: '✗'
}

const STATUS_COLOR: Record<StepStatus, string> = {
  pending: 'var(--muted-foreground)',
  running: '#f59e0b',
  done: '#10b981',
  skipped: 'var(--muted-foreground)',
  failed: 'var(--destructive)'
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
    const t = setInterval(() => force((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [plan.status])

  if (plan.steps.length === 0) return null

  const done = plan.steps.filter((s) => s.status === 'done').length
  const total = plan.steps.length

  return (
    <div className="bg-muted mb-4 overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="hover:bg-background flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors"
      >
        {collapsed ? (
          <HugeiconsIcon
            icon={ArrowRight01Icon}

            className="text-muted-foreground h-4 w-4"
          />
        ) : (
          <HugeiconsIcon
            icon={ArrowDown01Icon}

            className="text-muted-foreground h-4 w-4"
          />
        )}
        <span className="text-foreground text-ui flex-1 truncate font-semibold">
          {plan.summary}
        </span>
        <span className="text-muted-foreground text-2xs">
          {done}/{total} · {elapsedLabel(plan)}
        </span>
        <StatusPill status={plan.status} />
      </button>
      {!collapsed && (
        <div className="border-border border-t">
          {plan.steps.map((s) => {
            const agent = s.assignedAgentId
              ? agentsById[s.assignedAgentId]
              : undefined
            return (
              <div
                key={s.id}
                className={cn(
                  'flex items-start gap-3 px-4 py-2.5',
                  s.status === 'running' && 'bg-background'
                )}
              >
                <span
                  className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-xs"
                  style={{ color: STATUS_COLOR[s.status] }}
                  aria-label={stepStatusAria[s.status]}
                >
                  {s.status === 'done' ? (
                    <HugeiconsIcon
                      icon={Tick02Icon}

                      className="h-3.5 w-3.5"
                    />
                  ) : s.status === 'failed' ? (
                    <HugeiconsIcon
                      icon={Cancel01Icon}

                      className="h-3.5 w-3.5"
                    />
                  ) : (
                    STATUS_GLYPH[s.status]
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'text-ui font-medium',
                      s.status === 'done' &&
                        'text-muted-foreground line-through',
                      s.status === 'skipped' && 'text-muted-foreground',
                      s.status !== 'done' &&
                        s.status !== 'skipped' &&
                        'text-foreground'
                    )}
                  >
                    {s.ordinal + 1}. {s.title}
                  </div>
                  {s.intent && (
                    <div className="text-muted-foreground text-xs">
                      {s.intent}
                    </div>
                  )}
                  {s.output && s.status === 'done' && (
                    <div className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                      → {s.output}
                    </div>
                  )}
                  {s.note && (
                    <div className="mt-1 text-xs text-amber-500">{s.note}</div>
                  )}
                </div>
                {agent && (
                  <EmployeeAvatar
                    seed={agent.avatarSeed}
                    style={agent.avatarStyle}
                    size={24}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
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
  return (
    <span
      className={cn(
        'bg-muted rounded-full px-2 py-0.5 text-2xs font-medium',
        status === 'completed'
          ? 'text-emerald-500'
          : status === 'aborted'
            ? 'text-destructive'
            : 'text-amber-500'
      )}
    >
      {label}
    </span>
  )
}
