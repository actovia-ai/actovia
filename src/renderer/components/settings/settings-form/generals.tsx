import { IS_WEB_CLIENT } from '@actovia/shared/constants/systems'
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
import { Globe02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Flag } from '@/components/app/flag'
import { Switch } from '@/components/ui/switch'
import { setLoginItem, setMenuBar } from '@/lib/ipc'
import { applyReducedMotion } from '@/lib/reduced-motion'
import { applyTone } from '@/lib/tone'
import { cn } from '@/lib/utils'

import { AppearanceSwitcher } from '../appearance-switcher'
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
    if (!IS_WEB_CLIENT) setLoginItem(runOnStartup)
  }, [runOnStartup])

  useEffect(() => {
    if (!IS_WEB_CLIENT) setMenuBar(menuBarEnabled)
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
          label={t('general.reduceMotion.label')}
          description={t('general.reduceMotion.description')}
        >
          <Switch
            data-testid={TEST_IDS.settings.reduceMotion}
            aria-label={t('general.reduceMotion.label')}
            aria-description={t('general.reduceMotion.description')}
            checked={form.watch('reduceMotion') ?? false}
            onCheckedChange={(checked) => {
              applyReducedMotion(checked)
              form.setValue('reduceMotion', checked)
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

        {!IS_WEB_CLIENT && (
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
        )}

        {!IS_WEB_CLIENT && (
          <SettingsRow
            label={t('general.menuBar.label')}
            description={t('general.menuBar.description')}
          >
            <Switch
              checked={menuBarEnabled}
              onCheckedChange={(checked) => form.setValue('menuBar', checked)}
            />
          </SettingsRow>
        )}
      </SettingsSection>

      {!IS_WEB_CLIENT && <LockPrivacy />}
    </>
  )
}
