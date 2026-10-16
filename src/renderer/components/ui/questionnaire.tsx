import { Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Questionnaire as QuestionnairePrimitive } from '@shadcn/react/questionnaire'
import { cn } from 'cn'
import * as React from 'react'

import { buttonVariants, type Button } from '@/components/ui/button'

function Questionnaire({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Root>) {
  return (
    <QuestionnairePrimitive.Root
      data-slot="questionnaire"
      className={cn('flex w-full min-w-0 flex-col gap-4', className)}
      {...props}
    />
  )
}

function QuestionnaireProgress({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Progress>) {
  return (
    <QuestionnairePrimitive.Progress
      data-slot="questionnaire-progress"
      className={cn(
        'min-h-[1lh] w-fit min-w-[14ch] text-[0.625rem] font-medium text-muted-foreground tabular-nums',
        className
      )}
      {...props}
    />
  )
}

function QuestionnaireItem({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Item>) {
  return (
    <QuestionnairePrimitive.Item
      data-slot="questionnaire-item"
      className={cn(
        'flex min-w-0 flex-col gap-3 border-0 p-0 outline-none',
        className
      )}
      {...props}
    />
  )
}

function QuestionnaireTitle({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Title>) {
  return (
    <QuestionnairePrimitive.Title
      data-slot="questionnaire-title"
      className={cn(
        'text-sm font-semibold text-pretty [&:not(:has(~[data-slot=questionnaire-description]))]:mb-3',
        className
      )}
      {...props}
    />
  )
}

function QuestionnaireDescription({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Description>) {
  return (
    <QuestionnairePrimitive.Description
      data-slot="questionnaire-description"
      className={cn(
        'text-xs/relaxed text-pretty text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}

function QuestionnaireChoices({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choices>) {
  return (
    <QuestionnairePrimitive.Choices
      data-slot="questionnaire-choices"
      className={cn(
        'group/questionnaire-choices grid min-w-0 gap-1.5',
        className
      )}
      {...props}
    />
  )
}

/**
 * A choice's row, shared by the live choice and the answered one. Its padding
 * is what its 44 px leaves around one line, so a one-line choice sits in the
 * middle rather than at the top with the spare room under it.
 */
const CHOICE_ROW =
  'group/questionnaire-choice relative flex min-h-11 items-start gap-2.5 rounded-xl border border-input px-3 py-[calc((--spacing(11)-1lh)/2)] text-start text-xs/snug data-checked:border-primary/40 data-checked:bg-primary/10'

/**
 * A choice's box, centred on the label's first line whatever its size: the
 * row and the label share one line height, and the box sits half of what
 * that line has over 1rem below the top. A fixed nudge tuned for one line
 * height left it low beside the label's tighter one.
 */
function ChoiceIndicator() {
  return (
    <span
      aria-hidden="true"
      data-slot="questionnaire-choice-indicator"
      className="border-input group-data-checked/questionnaire-choice:border-primary group-data-checked/questionnaire-choice:bg-primary group-data-checked/questionnaire-choice:text-primary-foreground dark:bg-input/30 dark:group-data-checked/questionnaire-choice:bg-primary pointer-events-none relative mt-[calc((1lh-1rem)/2)] flex size-4 shrink-0 items-center justify-center rounded-[4px] border group-data-[type=radio]/questionnaire-choice:rounded-full"
    >
      <span
        data-slot="questionnaire-choice-indicator-dot"
        className="bg-primary-foreground hidden size-2 rounded-full group-data-checked/questionnaire-choice:block group-data-[type=checkbox]/questionnaire-choice:hidden"
      />
      <HugeiconsIcon
        icon={Tick02Icon}

        data-slot="questionnaire-choice-indicator-check"
        className="hidden size-3.5 group-data-checked/questionnaire-choice:block group-data-[type=radio]/questionnaire-choice:hidden"
      />
    </span>
  )
}

function QuestionnaireChoice({
  children,
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choice>) {
  return (
    <QuestionnairePrimitive.Choice
      data-slot="questionnaire-choice"
      className={cn(
        CHOICE_ROW,
        'cursor-pointer transition-colors outline-none select-none hover:bg-input/40 has-[>input:focus-visible]:border-ring has-[>input:focus-visible]:ring-2 has-[>input:focus-visible]:ring-ring/30 data-invalid:border-destructive',
        'data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className
      )}
      {...props}
    >
      <QuestionnairePrimitive.ChoiceInput
        data-slot="questionnaire-choice-input"
        className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
      />
      <ChoiceIndicator />
      <QuestionnairePrimitive.ChoiceLabel
        data-slot="questionnaire-choice-label"
        className="flex min-w-0 flex-1 flex-col gap-0.5 leading-snug"
      >
        {children}
      </QuestionnairePrimitive.ChoiceLabel>
      <QuestionnairePrimitive.ChoiceShortcut
        data-slot="questionnaire-choice-shortcut"
        className="border-input bg-background/80 text-muted-foreground pointer-events-none ms-auto mt-[calc((1lh-1rem)/2)] hidden size-4 shrink-0 items-center justify-center rounded-sm border text-[0.5625rem] leading-[calc(var(--text-xs)*var(--leading-snug))] font-medium group-data-[shortcut]/questionnaire-choice:inline-flex"
      />
    </QuestionnairePrimitive.Choice>
  )
}

/**
 * A choice as it was answered: the live choice's row and box, checked or not,
 * taking no input. The block keeps its own shape once answered, as on the
 * phone, rather than turning into a summary (owner, 2026-10-08).
 */
function QuestionnaireStaticChoice({
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

function QuestionnaireChoiceDescription({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="questionnaire-choice-description"
      className={cn('text-muted-foreground', className)}
      {...props}
    />
  )
}

function QuestionnaireInput({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Input>) {
  return (
    <div
      data-slot="questionnaire-input-wrapper"
      className="group/questionnaire-input relative w-full min-w-0"
    >
      <QuestionnairePrimitive.Input
        data-slot="questionnaire-input"
        className={cn(
          'h-7 min-h-11 w-full min-w-0 rounded-md border border-input bg-input/20 px-2 py-0.5 text-sm transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 sm:min-h-0 md:text-xs/relaxed dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
          'selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground',
          className
        )}
        {...props}
      />
    </div>
  )
}

function QuestionnaireError({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Error>) {
  return (
    <QuestionnairePrimitive.Error
      data-slot="questionnaire-error"
      className={cn('mt-2 text-xs/relaxed text-destructive', className)}
      {...props}
    />
  )
}

function QuestionnaireActions({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="questionnaire-actions"
      className={cn(
        'grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 sm:min-h-7',
        className
      )}
      {...props}
    />
  )
}

function QuestionnairePrevious({
  children,
  className,
  size = 'default',
  variant = 'outline',
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Previous> &
  Pick<React.ComponentProps<typeof Button>, 'size' | 'variant'>) {
  return (
    <QuestionnairePrimitive.Previous
      data-slot="questionnaire-previous"
      data-size={size}
      data-variant={variant}
      className={cn(
        buttonVariants({ size, variant }),
        'col-start-1 row-start-1 min-h-11 justify-self-start sm:min-h-0',
        className
      )}
      {...props}
    >
      {children ?? 'Previous'}
    </QuestionnairePrimitive.Previous>
  )
}

function QuestionnaireSkip({
  children,
  className,
  size = 'default',
  variant = 'outline',
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Skip> &
  Pick<React.ComponentProps<typeof Button>, 'size' | 'variant'>) {
  return (
    <QuestionnairePrimitive.Skip
      data-slot="questionnaire-skip"
      data-size={size}
      data-variant={variant}
      className={cn(
        buttonVariants({ size, variant }),
        'col-start-2 row-start-1 min-h-11 justify-self-end sm:min-h-0',
        className
      )}
      {...props}
    >
      {children ?? 'Skip'}
    </QuestionnairePrimitive.Skip>
  )
}

function QuestionnaireNext({
  children,
  className,
  size = 'default',
  variant = 'default',
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Next> &
  Pick<React.ComponentProps<typeof Button>, 'size' | 'variant'>) {
  return (
    <QuestionnairePrimitive.Next
      data-slot="questionnaire-next"
      data-size={size}
      data-variant={variant}
      className={cn(
        buttonVariants({ size, variant }),
        'col-start-3 row-start-1 min-h-11 justify-self-end sm:min-h-0',
        className
      )}
      {...props}
    >
      {children ?? 'Next'}
    </QuestionnairePrimitive.Next>
  )
}

function QuestionnaireSubmit({
  children,
  className,
  size = 'default',
  variant = 'default',
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Submit> &
  Pick<React.ComponentProps<typeof Button>, 'size' | 'variant'>) {
  return (
    <QuestionnairePrimitive.Submit
      data-slot="questionnaire-submit"
      data-size={size}
      data-variant={variant}
      className={cn(
        buttonVariants({ size, variant }),
        'col-start-3 row-start-1 min-h-11 justify-self-end sm:min-h-0',
        className
      )}
      {...props}
    >
      {children ?? 'Submit'}
    </QuestionnairePrimitive.Submit>
  )
}

export {
  CHOICE_ROW,
  ChoiceIndicator,
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireStaticChoice,
  QuestionnaireSubmit,
  QuestionnaireTitle
}
