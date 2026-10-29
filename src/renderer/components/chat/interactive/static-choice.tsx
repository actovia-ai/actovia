import { Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * A questionnaire choice outside a live questionnaire: an answered one, and
 * an agent's question in Philharmonic. `QuestionnaireChoice` needs the
 * questionnaire's context and renders an input, so these copy its row and
 * box instead. They live here, not in `components/ui/questionnaire.tsx`,
 * which the shadcn generator overwrites; keep the classes in step with it.
 */
export const CHOICE_ROW =
  'group/questionnaire-choice relative flex min-h-11 items-start gap-2.5 rounded-lg border border-input bg-transparent px-3 py-2.5 text-start text-sm dark:bg-input/20 data-checked:border-primary/40 data-checked:bg-muted dark:data-checked:bg-muted'

/** A choice's box: a round dot for one answer, a tick for several. */
export function ChoiceIndicator() {
  return (
    <span
      aria-hidden="true"
      data-slot="questionnaire-choice-indicator"
      className="border-input group-data-checked/questionnaire-choice:border-primary group-data-checked/questionnaire-choice:bg-primary group-data-checked/questionnaire-choice:text-primary-foreground dark:bg-input/30 dark:group-data-checked/questionnaire-choice:bg-primary pointer-events-none relative flex size-4 shrink-0 translate-y-[--spacing(0.45)] items-center justify-center rounded-[4px] border group-data-[type=radio]/questionnaire-choice:rounded-full"
    >
      <span
        data-slot="questionnaire-choice-indicator-dot"
        className="bg-primary-foreground hidden size-2 rounded-full group-data-checked/questionnaire-choice:block group-data-[type=checkbox]/questionnaire-choice:hidden"
      />
      <HugeiconsIcon
        icon={Tick02Icon}
        strokeWidth={2}
        data-slot="questionnaire-choice-indicator-check"
        className="hidden size-3.5 group-data-checked/questionnaire-choice:block group-data-[type=radio]/questionnaire-choice:hidden"
      />
    </span>
  )
}

/**
 * A choice as it was answered: the live choice's row and box, checked or not,
 * taking no input. The block keeps its own shape once answered, as on the
 * phone, rather than turning into a summary (owner, 2026-10-08).
 */
export function StaticChoice({
  type,
  checked,
  children,
  className
}: {
  type: 'radio' | 'checkbox'
  checked: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="questionnaire-choice"
      data-type={type}
      data-checked={checked ? '' : undefined}
      role={type}
      aria-checked={checked}
      aria-disabled
      className={cn(CHOICE_ROW, !checked && 'opacity-60', className)}
    >
      <ChoiceIndicator />
      <span
        data-slot="questionnaire-choice-label"
        className="flex min-w-0 flex-1 flex-col gap-0.5 leading-snug"
      >
        {children}
      </span>
    </div>
  )
}
