import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  LOCALE_IDS,
  LOCALES,
  type LanguageSetting
} from '@actovia/shared/i18n/locales'
import {
  COLOR_TONES,
  type ColorTone,
  type UseFormReturnType
} from '@actovia/shared/schemas/settings-schema'
import {
  ComputerIcon,
  Globe02Icon,
  MoonIcon,
  Sun03Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import type { ParseKeys } from 'i18next'
import { useTheme } from 'next-themes'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Flag } from '@/components/app/flag'
import { Theme } from '@/components/app/theme-provider'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { setLoginItem, setMenuBar } from '@/lib/ipc'
import { applyTone } from '@/lib/tone'
import { cn } from '@/lib/utils'

import { SettingsRow, SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'
import { LockPrivacy } from './lock-privacy'
import { SecretsNotices } from './secrets-notices'

/** `auto` first (native name resolved from `t()` at render time, paired with
 * a globe rather than any one country's flag), then every concrete locale in
 * its own native name and flag — never translated, since a locale name is
 * that language's own name for itself, not app UI copy. */
const LANGUAGE_OPTIONS: {
  value: LanguageSetting
  nativeName: string | null
  /** null for `auto`: a globe, never one country's flag. */
  flagCode: string | null
}[] = [
  { value: 'auto', nativeName: null, flagCode: null },
  ...LOCALE_IDS.map((id) => ({
    value: id,
    nativeName: LOCALES[id].nativeName,
    flagCode: LOCALES[id].flagCode
  }))
]

const APPEARANCE_MODES: {
  value: Theme
  labelKey: ParseKeys<'settings'>
  icon: IconSvgElement
}[] = [
  { value: 'system', labelKey: 'general.theme.system', icon: ComputerIcon },
  { value: 'light', labelKey: 'general.theme.light', icon: Sun03Icon },
  { value: 'dark', labelKey: 'general.theme.dark', icon: MoonIcon }
]

function AppearanceSwitcher() {
  const { t } = useTranslation('settings')
  const { theme, setTheme } = useTheme()

  return (
    <div className="bg-muted inline-flex w-fit gap-0.5 rounded-full p-0.5">
      {APPEARANCE_MODES.map(({ value, labelKey, icon: Icon }) => (
        <span key={value}>
          <input
            className="peer sr-only"
            type="radio"
            id={`appearance-mode-${value}`}
            name="appearance-mode"
            value={value}
            checked={theme === value}
            onChange={(event) => setTheme(event.target.value)}
          />
          {/* Three bare glyphs: each names itself on hover, and to a
              screen reader through its label. */}
          <Tooltip>
            <TooltipTrigger
              render={
                <label
                  htmlFor={`appearance-mode-${value}`}
                  data-testid={`${TEST_IDS.settings.themeMode}-${value}`}
                  aria-label={t(labelKey)}
                  className="text-muted-foreground peer-checked:bg-background peer-checked:text-foreground peer-focus-visible:ring-ring/50 flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors peer-checked:shadow-sm peer-focus-visible:ring-2"
                />
              }
            >
              <HugeiconsIcon icon={Icon} className="size-4" />
            </TooltipTrigger>
            <TooltipContent>{t(labelKey)}</TooltipContent>
          </Tooltip>
        </span>
      ))}
    </div>
  )
}

// The dot for each tone is its fill, `--primary` of its `[data-tone]` block
// in globals.css (`tone-palette.test.ts` holds the two equal); neutral is
// the default look — black, and white in the dark.
export const TONE_SWATCHES: Record<ColorTone, string> = {
  neutral: 'var(--tone-neutral)',
  emerald: '#6CB362',
  blue: '#5480F0',
  violet: '#8553E7',
  rose: '#E17EAD',
  orange: '#DE8344',
  yellow: '#EDC859'
}

function ColorTonePicker({
  value,
  onChange
}: {
  value: ColorTone
  onChange: (tone: ColorTone) => void
}) {
  const { t } = useTranslation('settings')
  return (
    <div className="flex items-center gap-2">
      {COLOR_TONES.map((tone) => {
        const label = t(`general.colorTone.tones.${tone}`)
        return (
          <button
            key={tone}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={value === tone}
            data-testid={`${TEST_IDS.settings.colorTone}-${tone}`}
            className={cn(
              'size-6 rounded-full transition-[scale,box-shadow]',
              value === tone
                ? 'ring-ring ring-offset-background ring-2 ring-offset-2'
                : 'hover:scale-110'
            )}
            style={{ backgroundColor: TONE_SWATCHES[tone] }}
            onClick={() => onChange(tone)}
          />
        )
      })}
    </div>
  )
}

export function General({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const runOnStartup = form.watch('runOnStartup') ?? false
  const menuBarEnabled = form.watch('menuBar') ?? true
  const language: LanguageSetting = form.watch('language') ?? 'auto'
  const tone: ColorTone = form.watch('colorTone') ?? 'neutral'

  const languageOptions = useMemo(
    () =>
      LANGUAGE_OPTIONS.map((o) => ({
        value: o.value,
        label: o.nativeName ?? t('general.language.auto'),
        icon: o.flagCode ? (
          <Flag code={o.flagCode} />
        ) : (
          <HugeiconsIcon
            icon={Globe02Icon}

            aria-hidden
            className="text-muted-foreground size-4"
          />
        )
      })),
    [t]
  )

  useEffect(() => {
    setLoginItem(runOnStartup)
  }, [runOnStartup])

  useEffect(() => {
    setMenuBar(menuBarEnabled)
  }, [menuBarEnabled])

  return (
    <>
      <SecretsNotices />
      <SettingsSection>
        <SettingsRow
          label={t('general.theme.label')}
          description={t('general.theme.description')}
        >
          <AppearanceSwitcher />
        </SettingsRow>

        <SettingsRow
          label={t('general.colorTone.label')}
          description={t('general.colorTone.description')}
        >
          <ColorTonePicker
            value={tone}
            onChange={(next) => {
              // Paint now; the autosave persists it and ToneBridge re-applies.
              applyTone(next)
              form.setValue('colorTone', next)
            }}
          />
        </SettingsRow>

        <SettingsRow
          label={t('general.language.label')}
          description={t('general.language.description')}
        >
          <SettingsSelect
            testId={TEST_IDS.settings.languageSelect}
            value={language}
            onValueChange={(v) =>
              form.setValue('language', v as LanguageSetting)
            }
            options={languageOptions}
          />
        </SettingsRow>

        <SettingsRow
          label={t('general.runOnStartup.label')}
          description={t('general.runOnStartup.description')}
        >
          <Switch
            checked={runOnStartup}
            onCheckedChange={(checked) =>
              form.setValue('runOnStartup', checked)
            }
          />
        </SettingsRow>

        <SettingsRow
          label={t('general.menuBar.label')}
          description={t('general.menuBar.description')}
        >
          <Switch
            checked={menuBarEnabled}
            onCheckedChange={(checked) => form.setValue('menuBar', checked)}
          />
        </SettingsRow>
      </SettingsSection>

      <LockPrivacy />
    </>
  )
}
