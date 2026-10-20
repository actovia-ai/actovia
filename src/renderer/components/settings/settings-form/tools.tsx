import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  GROUP_TITLE_KEYS,
  TOOL_GROUPS,
  TOOL_REGISTRY,
  type ToolMeta
} from '@actovia/shared/constants/tools'
import type { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Reveal } from '@/components/motion/morph'
import { Button } from '@/components/ui/button'
import { FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import { SettingsIntro } from '../settings-kit'
import { SettingsSection } from '../settings-row'
import { TOOL_CONFIG, type ToolConfig } from './tool-config'

/**
 * Settings → Built-in Tools. One hairline row per tool — name, what it does,
 * its switch — grouped the way the registry groups them. A tool with
 * something to set up carries its panel under the row, open by default;
 * Configure beside the switch folds it away and back (`Reveal`, 250 ms
 * ease-out). A tool that is on but missing the one thing it cannot work
 * without says so in red until it is there. The switch and the disclosure
 * are independent: a key can be entered before the tool is turned on.
 */

interface RowProps {
  tool: ToolMeta
  enabled: boolean
  onToggle: (enabled: boolean) => void
}

function RowHead({
  tool,
  enabled,
  onToggle,
  hint,
  children
}: RowProps & { hint?: string; children?: React.ReactNode }) {
  const { t } = useTranslation('settings')
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <FieldLabel>{t(tool.labelKey)}</FieldLabel>
        <FieldDescription>{t(tool.descriptionKey)}</FieldDescription>
        {hint && <p className="text-destructive text-xs">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {children}
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          data-testid={TEST_IDS.tools.toggle}
          data-tool={tool.key}
        />
      </div>
    </div>
  )
}

function ConfigurableRow({
  config,
  form,
  ...row
}: RowProps & { config: ToolConfig; form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const needed = useWatch({ control: form.control, name: config.needs.field })
  const missing = !needed
  const [open, setOpen] = useState(true)

  return (
    <div>
      <RowHead
        {...row}
        hint={row.enabled && missing ? t(config.needs.hintKey) : undefined}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          data-testid={TEST_IDS.tools.configure}
          data-tool={row.tool.key}
          // Open is the resting state, so it must not look pressed (the
          // ghost variant fills on aria-expanded for menu triggers); the
          // chevron says which way it is.
          className="text-muted-foreground hover:text-foreground aria-expanded:text-muted-foreground hover:aria-expanded:bg-muted hover:aria-expanded:text-foreground aria-expanded:bg-transparent"
        >
          {t('tools.configure')}
          <HugeiconsIcon
            icon={ArrowDown01Icon}

            className={cn(
              'transition-transform duration-200 ease-out',
              open && 'rotate-180'
            )}
          />
        </Button>
      </RowHead>
      <Reveal
        open={open}
        data-testid={TEST_IDS.tools.panel}
        data-tool={row.tool.key}
      >
        <div className="bg-muted/40 mt-4 rounded-lg px-4 py-4">
          <config.Panel form={form} />
        </div>
      </Reveal>
    </div>
  )
}

export function Tools({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const disabledTools: string[] =
    useWatch({ control: form.control, name: 'tools.disabledTools' }) ?? []

  function toggle(key: string, enabled: boolean) {
    const current: string[] =
      (form.getValues('tools.disabledTools') as string[] | null) ?? []
    const next = enabled
      ? current.filter((k) => k !== key)
      : [...current.filter((k) => k !== key), key]
    form.setValue('tools.disabledTools', next, { shouldDirty: true })
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsIntro>
        <p>{t('tools.intro')}</p>
      </SettingsIntro>
      {TOOL_GROUPS.map((group) => (
        <SettingsSection key={group} title={t(GROUP_TITLE_KEYS[group])}>
          {TOOL_REGISTRY.filter((tool) => tool.group === group).map((tool) => {
            const config = TOOL_CONFIG[tool.key as keyof typeof TOOL_CONFIG]
            const row = {
              tool,
              enabled: !disabledTools.includes(tool.key),
              onToggle: (checked: boolean) => toggle(tool.key, checked)
            }
            return config ? (
              <ConfigurableRow
                key={tool.key}
                {...row}
                config={config}
                form={form}
              />
            ) : (
              <RowHead key={tool.key} {...row} />
            )
          })}
        </SettingsSection>
      ))}
    </div>
  )
}
