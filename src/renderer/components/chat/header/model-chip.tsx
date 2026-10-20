import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { CachedModelEntry } from '@actovia/shared/schemas/settings-schema'
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
import { useSettings } from '@/hooks/use-settings'
import {
  configuredProvider,
  hasProviderKey,
  modelCatalog,
  modelLabel
} from '@/lib/provider-labels'
import { cn } from '@/lib/utils'

const PROVIDERS_TAB = '/settings?tab=ai-providers'
const CHIP =
  'no-drag h-6 max-w-56 gap-1 rounded-full px-2.5 text-xs font-normal'

/**
 * The model answering this chat (spec 2026-10-08 §4): the provider's short
 * name and the model's display name. Click lists the provider's cached
 * catalog (what the Settings picker shows); a pick saves `providerConfig`'s
 * model and snapshot — the server reads settings per run, so the next
 * message uses it. No provider, no model or no key: the chip says so and
 * opens Settings › AI Providers. Switching the provider stays in Settings.
 */
export function ModelChip() {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const { data: settings, updateSettings } = useSettings()
  const [open, setOpen] = useState(false)
  const provider = configuredProvider(settings)
  const model = settings?.providerConfig?.model ?? null

  if (!settings || !provider || !model || !hasProviderKey(settings)) {
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

  const catalog = modelCatalog(settings, provider)
  const choose = async (entry: CachedModelEntry) => {
    setOpen(false)
    if (entry.id === model) return
    // The whole settings object goes back, as the Settings form posts it:
    // masked keys mean "unchanged" to the server.
    await updateSettings({
      ...settings,
      providerConfig: {
        ...settings.providerConfig,
        provider,
        model: entry.id,
        modelSnapshot: entry.snapshot
      }
    })
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
        <span className="truncate">{modelLabel(provider, model, catalog)}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3 shrink-0 opacity-60"
        />
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72 p-1">
        <p className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
          {t('header.modelMenu')}
        </p>
        {catalog.length === 0 ? (
          <div className="flex flex-col items-start gap-1 px-2 pb-2">
            <p className="text-muted-foreground text-xs">
              {t('header.noModels')}
            </p>
            <Button
              variant="link"
              size="xs"
              className="h-auto px-0"
              onClick={() => {
                setOpen(false)
                navigate(PROVIDERS_TAB)
              }}
            >
              {t('header.openProviders')}
            </Button>
          </div>
        ) : (
          <div role="menu" className="flex max-h-80 flex-col overflow-y-auto">
            {catalog.map((entry) => {
              const checked = entry.id === model
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  data-testid={TEST_IDS.chat.header.modelOption}
                  data-model={entry.id}
                  onClick={() => void choose(entry)}
                  className={cn(
                    'hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
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
        )}
      </PopoverContent>
    </Popover>
  )
}
