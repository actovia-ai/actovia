import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'

import { SettingsRow, SettingsSection } from '../settings-row'

export function DeepResearch({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('deepResearch')
  return (
    <SettingsSection>
      <Controller
        control={form.control}
        name="deepResearch.breadth"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('form.breadth.label')}
            description={t('form.breadth.description')}
            error={fieldState.error}
          >
            <Input
              placeholder="4"
              type="number"
              id="deep-research-breadth-input"
              {...field}
              value={field.value ?? ''}
              className="w-fit"
            />
          </SettingsRow>
        )}
      />
      <Controller
        control={form.control}
        name="deepResearch.depth"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('form.depth.label')}
            description={t('form.depth.description')}
            error={fieldState.error}
          >
            <Input
              placeholder="2"
              type="number"
              id="deep-research-depth-input"
              {...field}
              value={field.value ?? ''}
              className="w-fit"
            />
          </SettingsRow>
        )}
      />
    </SettingsSection>
  )
}
