import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { UsedMemory } from '@actovia/shared/types/memory'
import { AiBrainIcon, EditIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useSetAtom } from 'jotai'
import { memo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover'
import { useMemories, useRunMemoryUsage } from '@/hooks/use-memory'
import { useFormat } from '@/lib/format'
import { cn } from '@/lib/utils'
import { chatInputAtom, chatInputFocusAtom } from '@/stores/input'

// The Memory page's `?tab=` slug (`SETTINGS_TAB_SLUGS` — a deep-link
// contract, never renamed); spelled out so the chat's foot does not pull the
// whole settings menu in.
const MEMORY_SETTINGS_PATH = '/settings?tab=memory'

/**
 * "Used 2 memories · Work setup, Classical music" at the foot of a run,
 * opening to each entry as it reads now. Renders nothing when the run used
 * none — including a run from before usage was logged per run.
 *
 * Subscribes to its own run's usage only (`useRunMemoryUsage` narrows the
 * chat's record with `select`), so another run streaming does not reach it.
 */
export const UsedMemories = memo(function UsedMemories({
  chatId,
  runId
}: {
  chatId: string
  runId: string
}) {
  const used = useRunMemoryUsage(chatId, runId)
  if (used.length === 0) return null
  return <UsedMemoriesLine used={used} />
})

function UsedMemoriesLine({ used }: { used: UsedMemory[] }) {
  const { t } = useTranslation('chat')
  const format = useFormat()
  const [open, setOpen] = useState(false)
  // "Wrong?" hands focus to the composer; the popover must not take it
  // back to its trigger as it closes.
  const toComposer = useRef(false)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) toComposer.current = false
        setOpen(next)
      }}
    >
      <PopoverTrigger
        data-testid={TEST_IDS.chat.usedMemories.trigger}
        // `ENTER_UP` spelled out with the hover colour in one property list:
        // beside `transition-colors` it would lose its own transition to
        // tailwind-merge (same group, last wins), and with it the entrance.
        // Durations pair up with the properties: the entrance's 300 ms, the
        // hover's 150 ms.
        className={cn(
          'transition-[opacity,translate,scale,color] duration-[300ms,300ms,300ms,150ms] ease-out starting:translate-y-1.5 starting:opacity-0',
          'text-muted-foreground hover:text-foreground flex max-w-full items-center gap-1.5 self-start text-xs'
        )}
      >
        <HugeiconsIcon
          icon={AiBrainIcon}

          className="size-3.5 shrink-0"
        />
        <span className="truncate">
          {t('usedMemories.label', {
            count: used.length,
            keys: format.list(used.map((m) => m.key))
          })}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 gap-3"
        data-testid={TEST_IDS.chat.usedMemories.popover}
        finalFocus={() => !toComposer.current}
      >
        <UsedMemoriesList
          used={used}
          onWrong={() => {
            toComposer.current = true
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/** Mounted only while the popover is open: the live entries behind the
 *  logged ones — a deleted entry keeps its logged title, greyed. */
function UsedMemoriesList({
  used,
  onWrong
}: {
  used: UsedMemory[]
  onWrong: () => void
}) {
  const { t } = useTranslation('chat')
  const { data: list } = useMemories()
  const navigate = useNavigate()
  const setInput = useSetAtom(chatInputAtom)
  const requestFocus = useSetAtom(chatInputFocusAtom)

  const wrong = (key: string) => {
    setInput(t('usedMemories.prefill', { key }))
    requestFocus((n) => n + 1)
    onWrong()
  }

  return (
    <>
      <p className="text-muted-foreground text-xs">{t('usedMemories.intro')}</p>
      <ul className="flex max-h-80 flex-col gap-3 overflow-y-auto">
        {used.map((m) => {
          const current = list?.find((item) => item.id === m.id)
          // Unknown until the list loads; missing from it once it has.
          const deleted = list !== undefined && !current
          const key = current?.key ?? m.key
          return (
            <li
              key={m.id}
              data-deleted={deleted || undefined}
              className={cn('flex flex-col gap-1', deleted && 'opacity-50')}
            >
              {/* The entry's own fix sits in its title row: it is this
                  entry's action, not a line of the card. */}
              <div className="flex items-center gap-2">
                <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                  {key}
                </span>
                {deleted && (
                  <span className="text-muted-foreground text-xs">
                    {t('usedMemories.deleted')}
                  </span>
                )}
                {!deleted && (
                  <Button
                    variant="ghost"
                    size="xs"
                    data-testid={TEST_IDS.chat.usedMemories.wrong}
                    onClick={() => wrong(key)}
                    // A capsule in the tone: the one thing to do with an
                    // entry, so it reads as a button at a glance.
                    className="bg-primary/12 text-primary hover:bg-primary/20 hover:text-primary dark:bg-primary/20 dark:hover:bg-primary/30 shrink-0 rounded-full"
                  >
                    <HugeiconsIcon icon={EditIcon} />
                    {t('usedMemories.wrong')}
                  </Button>
                )}
              </div>
              {current && (
                <p className="text-muted-foreground text-xs">
                  {current.summary}
                </p>
              )}
              {current && current.details.length > 0 && (
                <ul className="text-muted-foreground list-disc pl-4 text-xs">
                  {current.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {/* How a wrong entry gets fixed, in a sentence; Settings is the
          secondary way, a link under it. */}
      <div className="flex flex-col items-start gap-1">
        <p className="text-muted-foreground text-xs">
          {t('usedMemories.fixHint')}
        </p>
        <Button
          variant="link"
          size="xs"
          data-testid={TEST_IDS.chat.usedMemories.openSettings}
          onClick={() => void navigate(MEMORY_SETTINGS_PATH)}
          className="h-auto px-0"
        >
          {t('usedMemories.openSettings')}
        </Button>
      </div>
    </>
  )
}
