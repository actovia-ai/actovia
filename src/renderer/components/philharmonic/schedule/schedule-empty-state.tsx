import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons'
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
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto px-6 py-8">
      <div className="w-full max-w-xl">
        <h2 className="text-center text-xl font-medium tracking-tight">
          {t('schedule.composer.emptyTitle')}
        </h2>
        <p className="text-muted-foreground mt-2 text-center text-sm">
          {t('schedule.composer.emptyDescription')}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {(['briefing', 'language', 'review'] as const).map((example) => (
            <Button
              key={example}
              data-testid={TEST_IDS.schedule.example}
              variant="ghost"
              className="bg-muted/40 hover:bg-muted h-auto min-h-12 justify-between gap-4 rounded-xl px-4 py-3 text-left font-normal whitespace-normal"
              onClick={() => {
                setInput(t(`schedule.composer.examples.${example}`))
                focus((n) => n + 1)
              }}
            >
              <span className="min-w-0 leading-relaxed">
                {t(`schedule.composer.examples.${example}`)}
              </span>
              <HugeiconsIcon
                icon={ArrowUpRight01Icon}
                className="text-muted-foreground size-4 shrink-0"
              />
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
