import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useSetAtom } from 'jotai'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { chatInputFocusAtom, scheduleInputAtom } from '@/stores/input'

/** Examples are drafts, never scheduled until the conversation saves them. */
export function ScheduleEmptyState() {
  const { t } = useTranslation('philharmonic')
  const setInput = useSetAtom(scheduleInputAtom)
  const focus = useSetAtom(chatInputFocusAtom)
  const labelId = useId()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex min-h-full px-6 py-6">
        <div
          role="group"
          aria-labelledby={labelId}
          className="m-auto w-full max-w-xl"
        >
          <h2
            id={labelId}
            className="text-muted-foreground mb-2 px-3 text-sm font-medium"
          >
            {t('schedule.composer.recommended')}
          </h2>
          {(
            [
              { key: 'briefing', emoji: '☀️' },
              { key: 'language', emoji: '🗣️' },
              { key: 'review', emoji: '📝' }
            ] as const
          ).map(({ key: example, emoji }) => (
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
              <span
                aria-hidden="true"
                className="mt-0.5 w-5 shrink-0 text-lg leading-5"
              >
                {emoji}
              </span>
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
