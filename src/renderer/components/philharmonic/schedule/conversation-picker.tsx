import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { Message01Icon, UserGroupIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor
} from '@/components/ui/combobox'
import { useFormat } from '@/lib/format'

type Conversation = { id: string; title: string; createdAt?: string | Date }
type Option = Conversation & {
  value: string
  label: string
  kind: 'chat' | 'group'
}

/** A bounded, searchable target list; full titles and kind remain readable. */
export function ConversationPicker({
  id,
  value,
  onChange,
  conversations,
  chats
}: {
  id: string
  value: string
  onChange: (value: string) => void
  conversations: Conversation[]
  chats: Conversation[]
}) {
  const { t } = useTranslation('philharmonic')
  const { dateTime } = useFormat()
  const anchor = useComboboxAnchor()
  const options = useMemo<Option[]>(
    () => [
      ...conversations.map((c) => ({
        ...c,
        value: c.id,
        label: c.title,
        kind: 'group' as const
      })),
      ...chats.map((c) => ({
        ...c,
        value: `chat:${c.id}`,
        label: c.title,
        kind: 'chat' as const
      }))
    ],
    [conversations, chats]
  )
  const selected = options.find((item) => item.value === value) ?? null
  const kindLabel = (kind: Option['kind']) =>
    t(kind === 'chat' ? 'schedule.form.chatLabel' : 'schedule.form.groupLabel')
  const dateLabel = (createdAt: Option['createdAt']) => {
    if (!createdAt) return ''
    const date = createdAt instanceof Date ? createdAt : new Date(createdAt)
    return Number.isFinite(date.getTime())
      ? dateTime(date, { year: 'numeric', month: 'short', day: 'numeric' })
      : ''
  }

  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(item) => onChange(item?.value ?? '')}
      itemToStringLabel={(item) => item.label}
      itemToStringValue={(item) => item.value}
      isItemEqualToValue={(a, b) => a.value === b.value}
      autoHighlight
    >
      <div ref={anchor} className="w-full min-w-0">
        <ComboboxInput
          id={id}
          data-testid={TEST_IDS.schedule.conversationPicker}
          className="w-full min-w-0"
          showClear
          placeholder={t('schedule.form.searchConversations')}
          title={selected?.label}
        />
      </div>
      <ComboboxContent
        anchor={anchor}
        className="no-drag w-(--anchor-width) min-w-0"
      >
        <ComboboxEmpty>{t('schedule.form.noConversations')}</ComboboxEmpty>
        <ComboboxList>
          {(item: Option) => (
            <ComboboxItem
              key={item.value}
              value={item}
              className="items-start gap-2.5 py-2"
              title={item.label}
            >
              <HugeiconsIcon
                icon={item.kind === 'chat' ? Message01Icon : UserGroupIcon}
                className="text-muted-foreground mt-0.5 size-4 shrink-0"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="line-clamp-2 text-sm leading-snug break-words">
                  {item.label}
                </span>
                <span className="text-muted-foreground text-xs">
                  {[kindLabel(item.kind), dateLabel(item.createdAt)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
