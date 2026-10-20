import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { Key01Icon } from '@hugeicons/core-free-icons'
import { Controller } from 'react-hook-form'
import { Trans, useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useSettingsTab } from '@/hooks/use-settings-tab'

import { ENTER_UP, SettingsIntro, SettingsNotice } from '../settings-kit'
import { SettingsLabel } from '../settings-menu'
import { SettingsRow, SettingsSection } from '../settings-row'

/**
 * Discover cannot run without the Brave key, so this is a caveat, not a
 * description: it is the page's one `Alert` (see `Discover`).
 */
export function BraveKeyHint({ onNavigate }: { onNavigate: () => void }) {
  return (
    <Trans ns="discover" i18nKey="braveKeyHint">
      Discover needs a Brave Search API key.{' '}
      <button
        type="button"
        className="text-foreground underline underline-offset-4"
        onClick={onNavigate}
      >
        Add one under Built-in Tools
      </button>
      .
    </Trans>
  )
}

export function Discover({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('discover')
  const hasBraveKey = !!form.watch('webSearch.braveApiKey')
  const [, setActiveSection] = useSettingsTab()

  return (
    <>
      <SettingsIntro>{t('alert')}</SettingsIntro>

      {!hasBraveKey && (
        <SettingsNotice icon={Key01Icon} className={ENTER_UP}>
          <BraveKeyHint
            onNavigate={() => setActiveSection(SettingsLabel.BuiltinTools)}
          />
        </SettingsNotice>
      )}

      <SettingsSection>
        <SettingsRow
          label={t('enable.label')}
          description={t('enable.description')}
        >
          <Controller
            control={form.control}
            name="discover.enabled"
            render={({ field }) => (
              <Switch
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
                data-testid={TEST_IDS.discover.enableToggle}
              />
            )}
          />
        </SettingsRow>

        <Controller
          control={form.control}
          name="discover.topicCount"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('topicCount.label')}
              description={t('topicCount.description')}
              error={fieldState.error}
            >
              <Input
                type="number"
                min={1}
                max={8}
                className="w-20"
                placeholder="4"
                {...field}
                value={field.value ?? ''}
                onChange={(e) => field.onChange(Number(e.target.value))}
              />
            </SettingsRow>
          )}
        />

        <Controller
          control={form.control}
          name="discover.articlesPerTopic"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('articlesPerTopic.label')}
              description={t('articlesPerTopic.description')}
              error={fieldState.error}
            >
              <Input
                type="number"
                min={1}
                max={5}
                className="w-20"
                placeholder="3"
                {...field}
                value={field.value ?? ''}
                onChange={(e) => field.onChange(Number(e.target.value))}
              />
            </SettingsRow>
          )}
        />
      </SettingsSection>
    </>
  )
}
