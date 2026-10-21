import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { AiProviders } from '@actovia/shared/types/ai'
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover'
import { useSetChatModel } from '@/hooks/use-chat-history'
import { useChatModel } from '@/hooks/use-chat-model'
import { useSettings } from '@/hooks/use-settings'
import {
  configuredProviders,
  modelCatalog,
  PROVIDER_SHORT_LABELS,
  providerHasKey
} from '@/lib/provider-labels'
import { cn } from '@/lib/utils'

const PROVIDERS_TAB = '/settings?tab=ai-providers'
const CHIP =
  'no-drag h-6 max-w-56 gap-1 rounded-full px-2.5 text-xs font-normal'

/**
 * The model answering this chat (spec 2026-10-08 §4; owner, 2026-10-21: the
 * model belongs to the chat). The chip names the model; its list holds every
 * provider that has a key and a fetched catalog, each under its name. A pick
 * is this chat's alone (`chat.provider` / `chat.model`): the default in
 * Settings — what a new chat starts with — is left as it is. No provider, no
 * model or no key: the chip says so and opens Settings › AI Providers.
 */
export function ModelChip({ chatId }: { chatId: string }) {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const { data: settings } = useSettings()
  const { provider, model } = useChatModel(chatId)
  const { mutate: setChatModel } = useSetChatModel()
  const [open, setOpen] = useState(false)

  if (!settings || !provider || !model || !providerHasKey(settings, provider)) {
    return (
      <Button
        variant="outline"
        size="xs"
        className={CHIP}
        data-testid={TEST_IDS.chat.header.modelChip}
        onClick={() => navigate(PROVIDERS_TAB)}
      >
        {t('header.noModel')}
      </Button>
    )
  }

  // The chat's own provider stays listed even while its catalog is empty.
  const listed = configuredProviders(settings)
  const providers = listed.includes(provider) ? listed : [provider, ...listed]
  const name =
    modelCatalog(settings, provider).find((m) => m.id === model)?.displayName ??
    model
  const openProviders = () => {
    setOpen(false)
    void navigate(PROVIDERS_TAB)
  }
  const choose = (next: AiProviders, id: string) => {
    setOpen(false)
    if (next === provider && id === model) return
    setChatModel({ id: chatId, provider: next, model: id })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className={CHIP}
            data-testid={TEST_IDS.chat.header.modelChip}
          />
        }
      >
        <span className="truncate">{name}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3 shrink-0 opacity-60"
        />
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72 p-1">
        <div role="menu" className="flex max-h-80 flex-col overflow-y-auto">
          {providers.map((p) => {
            const catalog = modelCatalog(settings, p)
            return (
              <div key={p} role="group" aria-label={PROVIDER_SHORT_LABELS[p]}>
                <p className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium">
                  {PROVIDER_SHORT_LABELS[p]}
                </p>
                {catalog.length === 0 && (
                  <p className="text-muted-foreground px-2 pb-1.5 text-xs">
                    {t('header.noModels')}
                  </p>
                )}
                {catalog.map((entry) => {
                  const checked = p === provider && entry.id === model
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={checked}
                      data-testid={TEST_IDS.chat.header.modelOption}
                      data-model={entry.id}
                      onClick={() => choose(p, entry.id)}
                      className={cn(
                        'hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                        checked && 'font-medium'
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {entry.displayName}
                      </span>
                      {checked && (
                        <HugeiconsIcon
                          icon={Tick02Icon}
                          className="size-4 shrink-0"
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
        <div className="mt-1 flex flex-col items-start gap-0.5 border-t px-2 pt-2 pb-1.5">
          <p className="text-muted-foreground text-xs">
            {t('header.modelScope')}
          </p>
          <Button
            variant="link"
            size="xs"
            className="h-auto px-0"
            onClick={openProviders}
          >
            {t('header.openProviders')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
