import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { AssistantTurn } from '@actovia/shared/types/chat'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

import { AssistantTurnSegment } from './assistant-turn-segment'

/**
 * The answer of a regenerate group that was not kept, to read — and, while
 * the group is still the chat's last exchange, to use instead.
 */
export function OtherVersionDialog({
  open,
  onOpenChange,
  chatId,
  turn,
  citationSources,
  locked,
  onUseInstead
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chatId: string
  turn: AssistantTurn
  citationSources?: WebSearchResult[]
  /** A later run exists: the choice can no longer move. */
  locked: boolean
  onUseInstead: () => void
}) {
  const { t } = useTranslation('chat')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('compare.otherVersionTitle')}</DialogTitle>
          <DialogDescription>
            {t('compare.otherVersionDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-2 min-h-0 overflow-y-auto px-2 text-sm">
          <AssistantTurnSegment
            chatId={chatId}
            turn={turn}
            citationSources={citationSources}
            isStreaming={false}
            fresh={false}
            answerable={false}
          />
        </div>

        <DialogFooter>
          {locked ? (
            <p className="text-muted-foreground text-sm">
              {t('compare.locked')}
            </p>
          ) : (
            <Button
              data-testid={TEST_IDS.chat.compare.useInstead}
              onClick={onUseInstead}
            >
              {t('compare.useInstead')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
