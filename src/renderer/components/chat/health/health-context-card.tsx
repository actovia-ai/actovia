import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  ArrowDown01Icon,
  DropletIcon,
  FootprintsIcon,
  FavouriteIcon,
  HeartPulseIcon,
  MoonIcon
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type HealthChipIcon,
  type HealthFormat,
  healthChips,
  healthDetails
} from '@/components/chat/health/health-context'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'

const ICONS: Record<HealthChipIcon, IconSvgElement> = {
  sleep: MoonIcon,
  steps: FootprintsIcon,
  heart: FavouriteIcon,
  water: DropletIcon,
  health: HeartPulseIcon
}

/**
 * A question asked from the phone's Health workspace opens with the numbers
 * it was asked about (`splitHealth`): drawn as a row of chips over the
 * question, as actovia-ios draws it. Opening it lists everything that was
 * sent, labelled. Display only — the message itself is unchanged.
 */
export function HealthContextCard({ json }: { json: string }) {
  const { t, i18n } = useTranslation('chat')
  const [open, setOpen] = useState(false)
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  // The keys are built from wire names (`health.category.${…}`), past what
  // the typed `t` can check; `i18n:check` and the tests hold them.
  const f: HealthFormat = useMemo(
    () => ({
      t: (key, options) => String(t(key as never, options as never)),
      locale
    }),
    [t, locale]
  )
  const chips = useMemo(() => healthChips(json, f), [json, f])
  const details = useMemo(() => healthDetails(json, f), [json, f])

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="whitespace-normal not-last:mb-1.5"
    >
      <CollapsibleTrigger
        data-testid={TEST_IDS.chat.health.trigger}
        aria-label={t('health.attached', {
          values: chips.map((c) => c.text).join(', ')
        })}
        className="group/health text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md px-1 py-0.5 text-left text-xs font-semibold transition-colors outline-none focus-visible:ring-2"
      >
        {chips.map((chip) => {
          const Icon = ICONS[chip.icon]
          return (
            <span
              key={`${chip.icon}:${chip.text}`}
              className="inline-flex items-center gap-1 tabular-nums"
            >
              <HugeiconsIcon
                icon={Icon}

                aria-hidden
                className="text-primary size-3.5 shrink-0"
              />
              {chip.text}
            </span>
          )
        })}
        <HugeiconsIcon
          icon={ArrowDown01Icon}

          aria-hidden
          className="size-3 shrink-0 transition-transform duration-200 group-data-panel-open/health:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent
        data-testid={TEST_IDS.chat.health.details}
        className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none"
      >
        <div className="bg-background/60 mt-1.5 flex flex-col gap-2.5 rounded-xl px-3 py-2.5 text-xs leading-normal">
          {details === null ? (
            <pre className="text-muted-foreground text-2xs font-mono break-all whitespace-pre-wrap select-text">
              {json}
            </pre>
          ) : (
            <>
              {details.heading && (
                <p className="text-muted-foreground">{details.heading}</p>
              )}
              {details.sections.map((section, i) => (
                <section key={`${section.title}:${i}`}>
                  <h4 className="text-foreground mb-1 font-semibold">
                    {section.title}
                  </h4>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                    {section.rows.map((row, j) => (
                      <div key={j} className="contents">
                        <dt className="text-muted-foreground">{row.label}</dt>
                        <dd className="text-foreground text-right whitespace-pre-line tabular-nums">
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
