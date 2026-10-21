import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Switch } from '@/components/ui/switch'
import {
  CATEGORY_TITLE_KEYS,
  keyLabel,
  SHORTCUT_MAP,
  ShortcutDef
} from '@/hooks/use-keyboard-shortcuts'
import { useSettings } from '@/hooks/use-settings'
import { cn } from '@/lib/utils'

import { SettingsSection } from '../settings-row'

function ShortcutRow({
  shortcut,
  disabled,
  onToggle
}: {
  shortcut: ShortcutDef
  disabled: boolean
  onToggle: (id: string, enabled: boolean) => void
}) {
  const { t } = useTranslation('settings')

  // Same shape as every other settings row: what it is on the left, the
  // control on the right. A shortcut that can't be turned off says so in
  // the switch's slot, so the keys stay in one column.
  return (
    <div className="flex items-center gap-4">
      <span
        className={cn(
          'flex-1 text-sm font-medium transition-colors',
          disabled && 'text-muted-foreground'
        )}
      >
        {t(shortcut.labelKey)}
      </span>
      <KbdGroup className={cn('transition-opacity', disabled && 'opacity-50')}>
        {shortcut.keys.map((key) => (
          <Kbd key={key}>{keyLabel(key)}</Kbd>
        ))}
      </KbdGroup>
      <div className="flex min-w-9 shrink-0 justify-end">
        {shortcut.toggleable !== false ? (
          <Switch
            checked={!disabled}
            onCheckedChange={(checked) => onToggle(shortcut.id, checked)}
          />
        ) : (
          <span className="text-muted-foreground text-xs whitespace-nowrap">
            {t('keyboardShortcuts.alwaysOn')}
          </span>
        )}
      </div>
    </div>
  )
}

function ShortcutGroup({
  title,
  shortcuts,
  disabledIds,
  onToggle
}: {
  title: string
  shortcuts: ShortcutDef[]
  disabledIds: Set<string>
  onToggle: (id: string, enabled: boolean) => void
}) {
  return (
    <SettingsSection title={title}>
      {shortcuts.map((s) => (
        <ShortcutRow
          key={s.id}
          shortcut={s}
          disabled={disabledIds.has(s.id)}
          onToggle={onToggle}
        />
      ))}
    </SettingsSection>
  )
}

export function KeyboardShortcuts() {
  const { t } = useTranslation('settings')
  const { data: settings, updateSettings } = useSettings()

  const disabledIds = useMemo(
    () => new Set(settings?.keyboardShortcuts?.disabled ?? []),
    [settings?.keyboardShortcuts?.disabled]
  )

  const grouped = useMemo(() => {
    const map = new Map<ShortcutDef['category'], ShortcutDef[]>()
    for (const s of SHORTCUT_MAP) {
      const list = map.get(s.category) ?? []
      list.push(s)
      map.set(s.category, list)
    }
    return map
  }, [])

  const handleToggle = (id: string, enabled: boolean) => {
    if (!settings) return
    const next = new Set(disabledIds)
    if (enabled) {
      next.delete(id)
    } else {
      next.add(id)
    }
    updateSettings({
      ...settings,
      keyboardShortcuts: { disabled: Array.from(next) }
    })
  }

  return (
    <>
      {Array.from(grouped.entries()).map(([category, shortcuts]) => (
        <ShortcutGroup
          key={category}
          title={t(CATEGORY_TITLE_KEYS[category])}
          shortcuts={shortcuts}
          disabledIds={disabledIds}
          onToggle={handleToggle}
        />
      ))}
    </>
  )
}
