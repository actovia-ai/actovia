import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { SidebarRightIcon } from '@hugeicons/core-free-icons'
import { useAtom, useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'

import { TooltipProvider } from '@/components/ui/tooltip'
import { useChatHistory } from '@/hooks/use-chat-history'
import { chatPanelItems, hasPanelItems } from '@/lib/chat-panel-items'
import { chatMessagesAtom, chatPanelAtom } from '@/stores/chat'
import { chatStatusAtom } from '@/stores/input'

import { ChatMenu } from './chat-menu'
import { HeaderButton } from './header-button'
import { ModelChip } from './model-chip'

/**
 * The chat header (spec 2026-10-08 §2), after the sidebar toggle and the
 * history arrows: on the left, on a chat page, the title with a dot while a
 * reply is on its way, the model chip and the `▾` menu; on the right the
 * panel toggle. A left-and-right bar, as Claude's (owner, 2026-10-08), not a
 * centred title. The header is the window's drag region,
 * so every control here is `no-drag`.
 */
export function ChatHeader() {
  const { id } = useParams<{ id: string }>()

  return (
    <TooltipProvider>
      <div className="flex min-w-0 flex-1 items-center gap-2 self-stretch">
        {id && <TitleGroup id={id} />}
        <div className="min-w-0 flex-1" />
        {id && <PanelToggle />}
      </div>
    </TooltipProvider>
  )
}

/** The title (the list's, live: the title stream invalidates the list), a dot while replying, the chip, the menu. */
function TitleGroup({ id }: { id: string }) {
  const { t } = useTranslation('chat')
  const { data: history } = useChatHistory()
  const chat = history?.find((c) => c.id === id)
  const title = chat?.title ?? t('sidebar.newChat')
  const status = useAtomValue(chatStatusAtom)
  const replying = status === 'submitted' || status === 'streaming'

  return (
    <div className="no-drag flex max-w-lg min-w-0 items-center gap-2 pl-2">
      <h1
        className="truncate text-sm font-medium"
        title={title}
        data-testid={TEST_IDS.chat.header.title}
      >
        {title}
      </h1>
      {replying && (
        <span
          className="bg-primary-ink size-1.5 shrink-0 rounded-full"
          role="status"
          aria-label={t('header.streaming')}
          data-streaming=""
        />
      )}
      <ModelChip />
      <ChatMenu chat={chat} />
    </div>
  )
}

/** Opens the panel on its last section; a dot when it has anything to show. */
function PanelToggle() {
  const { t } = useTranslation('chat')
  const [panel, setPanel] = useAtom(chatPanelAtom)
  const messages = useAtomValue(chatMessagesAtom)
  const hasItems = useMemo(
    () => hasPanelItems(chatPanelItems(messages)),
    [messages]
  )
  return (
    <div className="relative">
      <HeaderButton
        label={t('header.panel')}
        icon={SidebarRightIcon}
        pressed={panel.open}
        onClick={() =>
          setPanel({ ...panel, open: !panel.open, runId: undefined })
        }
        testId={TEST_IDS.chat.header.panelToggle}
      />
      {hasItems && (
        <span
          className="bg-primary-ink pointer-events-none absolute top-1 right-1 size-1.5 rounded-full"
          data-has-items=""
        />
      )}
    </div>
  )
}
