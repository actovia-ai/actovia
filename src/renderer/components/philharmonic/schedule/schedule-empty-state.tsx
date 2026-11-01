import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { AddCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { chatInputFocusAtom, scheduleInputAtom } from '@/stores/input'

/** Examples are drafts, never scheduled until the conversation saves them. */
export function ScheduleEmptyState() {
  const { t } = useTranslation('philharmonic')
  const setInput = useSetAtom(scheduleInputAtom)
  const focus = useSetAtom(chatInputFocusAtom)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-3">
        <div
          role="group"
          aria-label={t('schedule.composer.emptyTitle')}
          className="divide-border divide-y"
        >
          {(['briefing', 'language', 'review'] as const).map((example) => (
            <Button
              key={example}
              data-testid={TEST_IDS.schedule.example}
              type="button"
              variant="ghost"
              className="h-auto min-h-20 w-full items-start justify-start gap-3 rounded-xl px-3 py-4 text-left font-normal whitespace-normal"
              onClick={() => {
                setInput(t(`schedule.composer.examples.${example}`))
                focus((n) => n + 1)
              }}
            >
              <HugeiconsIcon
                icon={AddCircleIcon}
                className="text-muted-foreground mt-0.5 size-5 shrink-0"
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block font-medium">
                  {t(`schedule.composer.exampleTitles.${example}`)}
                </span>
                <span className="text-muted-foreground mt-1 block leading-relaxed">
                  {t(`schedule.composer.examples.${example}`)}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
