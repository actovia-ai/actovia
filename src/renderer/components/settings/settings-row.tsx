import React from 'react'
import type { FieldError as RHFFieldError } from 'react-hook-form'

import { Card } from '@/components/ui/card'
import { FieldDescription, FieldLabel } from '@/components/ui/field'
import { cn } from '@/lib/utils'

// ─── SettingsSection ──────────────────────────────────────────────────────────

interface SettingsSectionProps {
  /** Optional heading rendered above the card. */
  title?: string
  /**
   * Render children in a bare stack instead of a bordered card — for sections
   * that hold custom panels (filter bars, lists, wizards) rather than
   * SettingsRow items.
   */
  plain?: boolean
  children: React.ReactNode
}

/**
 * Groups SettingsRow items into a bordered card with hairline dividers between
 * rows, ChatGPT-settings style. The card owns the row padding; pass `title` for
 * the section heading above it, or `plain` to opt out of the card entirely.
 */
export function SettingsSection({
  title,
  plain,
  children
}: SettingsSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      {title && (
        <h2 className="text-muted-foreground px-1 text-xs font-medium tracking-wide uppercase">
          {title}
        </h2>
      )}
      {plain ? (
        <div className="flex flex-col gap-4">{children}</div>
      ) : (
        <Card className="divide-border gap-0 divide-y px-3 py-0 *:px-2.5 *:py-4">
          {children}
        </Card>
      )}
    </section>
  )
}

// ─── SettingsRow ──────────────────────────────────────────────────────────────

interface SettingsRowProps {
  label: string
  description?: string
  children: React.ReactNode
  error?: RHFFieldError
  /**
   * Non-blocking red hint shown alongside `error` — e.g. a saved value that
   * is still valid but no longer recommended (a model dropped from the
   * provider lineup).
   */
  warning?: React.ReactNode
  /**
   * Layout mode:
   * - "horizontal" (default): label+desc left, control right (for Select, Switch, short inputs)
   * - "vertical": label → desc → control → error stacked top-to-bottom (for full-width Input, multi-select)
   */
  layout?: 'horizontal' | 'vertical'
}

/**
 * Standardized setting row. Sits inside a SettingsSection card, which supplies
 * the padding and dividers.
 */
export function SettingsRow({
  label,
  description,
  children,
  error,
  warning,
  layout = 'horizontal'
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        'flex gap-4',
        layout === 'vertical'
          ? 'flex-col gap-1.5'
          : 'items-center justify-between'
      )}
      data-invalid={!!error || undefined}
    >
      {layout === 'vertical' ? (
        <>
          <FieldLabel>{label}</FieldLabel>
          {description && <FieldDescription>{description}</FieldDescription>}
          {/* One box for the control and what comes and goes under it: the
              description's spacing is positional (nth-last-2), so a paste
              that drops a SecretInput's sr-only label, or an error showing
              up, must not change how many siblings follow it. */}
          <div className="flex flex-col gap-1.5">
            {children}
            {error && (
              <p className="text-destructive text-xs">{error.message}</p>
            )}
            {!error && warning && (
              <p className="text-destructive text-xs">{warning}</p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex max-w-[80%] flex-col gap-1">
            <FieldLabel>{label}</FieldLabel>
            {description && <FieldDescription>{description}</FieldDescription>}
            {error && (
              <p className="text-destructive text-xs">{error.message}</p>
            )}
            {!error && warning && (
              <p className="text-destructive text-xs">{warning}</p>
            )}
          </div>
          <div className="shrink-0">{children}</div>
        </>
      )}
    </div>
  )
}
