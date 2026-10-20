import type { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import { SettingsRow, SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'

type BaseStyle =
  | 'default'
  | 'professional'
  | 'friendly'
  | 'candid'
  | 'quirky'
  | 'efficient'
  | 'cynical'
type Level = 'default' | 'more' | 'less'

export function Personality({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const baseStyle = form.watch('personality.baseStyle') ?? 'default'
  const warm = form.watch('personality.warm') ?? 'default'
  const enthusiastic = form.watch('personality.enthusiastic') ?? 'default'
  const headersAndLists = form.watch('personality.headersAndLists') ?? 'default'
  const emoji = form.watch('personality.emoji') ?? 'default'

  const baseStyleOptions = useMemo(
    () => [
      { value: 'default', label: t('personality.baseStyle.options.default') },
      {
        value: 'professional',
        label: t('personality.baseStyle.options.professional')
      },
      {
        value: 'friendly',
        label: t('personality.baseStyle.options.friendly')
      },
      { value: 'candid', label: t('personality.baseStyle.options.candid') },
      { value: 'quirky', label: t('personality.baseStyle.options.quirky') },
      {
        value: 'efficient',
        label: t('personality.baseStyle.options.efficient')
      },
      { value: 'cynical', label: t('personality.baseStyle.options.cynical') }
    ],
    [t]
  )

  const levelOptions = useMemo(
    () => [
      { value: 'default', label: t('personality.level.default') },
      { value: 'more', label: t('personality.level.more') },
      { value: 'less', label: t('personality.level.less') }
    ],
    [t]
  )

  return (
    <>
      <SettingsSection title={t('personality.sections.style')}>
        {/* Personalization */}
        <SettingsRow
          label={t('personality.baseStyle.label')}
          description={t('personality.baseStyle.description')}
        >
          <SettingsSelect
            value={baseStyle}
            onValueChange={(v) =>
              form.setValue('personality.baseStyle', v as BaseStyle)
            }
            options={baseStyleOptions}
          />
        </SettingsRow>

        <SettingsRow label={t('personality.warm')}>
          <SettingsSelect
            value={warm}
            onValueChange={(v) => form.setValue('personality.warm', v as Level)}
            options={levelOptions}
          />
        </SettingsRow>

        <SettingsRow label={t('personality.enthusiastic')}>
          <SettingsSelect
            value={enthusiastic}
            onValueChange={(v) =>
              form.setValue('personality.enthusiastic', v as Level)
            }
            options={levelOptions}
          />
        </SettingsRow>

        <SettingsRow label={t('personality.headersAndLists')}>
          <SettingsSelect
            value={headersAndLists}
            onValueChange={(v) =>
              form.setValue('personality.headersAndLists', v as Level)
            }
            options={levelOptions}
          />
        </SettingsRow>

        <SettingsRow label={t('personality.emoji')}>
          <SettingsSelect
            value={emoji}
            onValueChange={(v) =>
              form.setValue('personality.emoji', v as Level)
            }
            options={levelOptions}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t('personality.sections.instructions')}>
        <SettingsRow
          label={t('personality.customInstructions.label')}
          layout="vertical"
        >
          <Textarea
            placeholder={t('personality.customInstructions.placeholder')}
            className="min-h-20"
            value={form.watch('personality.customInstructions') ?? ''}
            onChange={(e) =>
              form.setValue('personality.customInstructions', e.target.value)
            }
          />
        </SettingsRow>

        {/* About you */}
      </SettingsSection>

      <SettingsSection title={t('personality.sections.aboutYou')}>
        <SettingsRow label={t('personality.nickname.label')} layout="vertical">
          <Input
            placeholder={t('personality.nickname.placeholder')}
            value={form.watch('personality.nickname') ?? ''}
            onChange={(e) =>
              form.setValue('personality.nickname', e.target.value)
            }
          />
        </SettingsRow>

        <SettingsRow
          label={t('personality.occupation.label')}
          layout="vertical"
        >
          <Input
            placeholder={t('personality.occupation.placeholder')}
            value={form.watch('personality.occupation') ?? ''}
            onChange={(e) =>
              form.setValue('personality.occupation', e.target.value)
            }
          />
        </SettingsRow>

        <SettingsRow label={t('personality.aboutYou.label')} layout="vertical">
          <Textarea
            placeholder={t('personality.aboutYou.placeholder')}
            className="min-h-[80px]"
            value={form.watch('personality.aboutYou') ?? ''}
            onChange={(e) =>
              form.setValue('personality.aboutYou', e.target.value)
            }
          />
        </SettingsRow>
      </SettingsSection>
    </>
  )
}
