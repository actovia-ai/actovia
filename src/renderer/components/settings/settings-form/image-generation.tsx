import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { useEffect, useMemo } from 'react'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'

import { SettingsRow, SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'

type ModelParamValues = {
  [index: string]: {
    sizes: string[]
    qualities: string[]
    outputFormats?: string[]
    generatedCounts: { min: number; max: number }
    backgrounds?: string[]
  }
}

const gptImageParams = {
  sizes: ['1024x1024', '1536x1024', '1024x1536', 'auto'],
  qualities: ['high', 'medium', 'low', 'auto'],
  outputFormats: ['png', 'jpeg', 'webp'],
  generatedCounts: { min: 1, max: 10 },
  backgrounds: ['transparent', 'opaque', 'auto']
}

const modelParams: ModelParamValues = {
  'gpt-image-2': gptImageParams,
  'gpt-image-1.5': gptImageParams,
  'gpt-image-1-mini': gptImageParams
}

export function ImageGeneration({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const background = form.watch('image.background')
  const model = form.watch('image.model')
  const paramsOfModel = useMemo(
    () => (model ? modelParams[model] : null),
    [model]
  )

  useEffect(() => {
    form.setValue('image.size', 'auto')
    form.setValue('image.quality', 'auto')
    form.setValue('image.outputFormat', '')
    form.setValue('image.background', '')
    form.setValue('image.generatedCounts', 1)
  }, [form, model])

  useEffect(() => {
    if (model?.startsWith('gpt-image-')) {
      if (background === 'transparent') {
        form.setValue('image.outputFormat', 'png')
      }
    }
  }, [background, form, model])

  return (
    <SettingsSection plain>
      <Controller
        control={form.control}
        name="image.model"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('tools.imageGeneration.model.label')}
            description={t('tools.imageGeneration.model.description')}
            error={fieldState.error}
          >
            <SettingsSelect
              value={field.value ?? ''}
              onValueChange={field.onChange}
              placeholder={t('tools.imageGeneration.model.placeholder')}
              options={[
                { value: 'gpt-image-2', label: 'gpt-image-2' },
                { value: 'gpt-image-1.5', label: 'gpt-image-1.5' },
                { value: 'gpt-image-1-mini', label: 'gpt-image-1-mini' }
              ]}
            />
          </SettingsRow>
        )}
      />

      {paramsOfModel?.sizes ? (
        <Controller
          control={form.control}
          name="image.size"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.imageGeneration.size.label')}
              description={t('tools.imageGeneration.size.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                placeholder={paramsOfModel.sizes[0]}
                options={paramsOfModel.sizes.map((size) => ({
                  value: size,
                  label: size
                }))}
              />
            </SettingsRow>
          )}
        />
      ) : null}

      {paramsOfModel?.qualities ? (
        <Controller
          control={form.control}
          name="image.quality"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.imageGeneration.quality.label')}
              description={t('tools.imageGeneration.quality.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                placeholder={paramsOfModel.qualities[0]}
                options={paramsOfModel.qualities.map((quality) => ({
                  value: quality,
                  label: quality
                }))}
              />
            </SettingsRow>
          )}
        />
      ) : null}

      {paramsOfModel?.outputFormats ? (
        <Controller
          control={form.control}
          name="image.outputFormat"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.imageGeneration.outputFormat.label')}
              description={t('tools.imageGeneration.outputFormat.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                placeholder={paramsOfModel?.outputFormats?.[0]}
                options={(paramsOfModel?.outputFormats ?? []).map((fmt) => ({
                  value: fmt,
                  label: fmt,
                  disabled: background === 'transparent' && fmt === 'jpeg'
                }))}
              />
            </SettingsRow>
          )}
        />
      ) : null}

      {paramsOfModel?.generatedCounts ? (
        <Controller
          control={form.control}
          name="image.generatedCounts"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.imageGeneration.generatedCounts.label')}
              description={t(
                'tools.imageGeneration.generatedCounts.description'
              )}
              error={fieldState.error}
            >
              <Input
                type="number"
                id="max-steps-input"
                {...field}
                min={paramsOfModel?.generatedCounts.min}
                max={paramsOfModel?.generatedCounts.max}
                value={field.value ?? ''}
                className="w-fit"
              />
            </SettingsRow>
          )}
        />
      ) : null}

      {paramsOfModel?.backgrounds ? (
        <Controller
          control={form.control}
          name="image.background"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.imageGeneration.background.label')}
              description={t('tools.imageGeneration.background.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                placeholder={paramsOfModel?.backgrounds?.[0]}
                options={
                  paramsOfModel?.backgrounds?.map((bg) => ({
                    value: bg,
                    label: bg
                  })) ?? []
                }
              />
            </SettingsRow>
          )}
        />
      ) : null}
    </SettingsSection>
  )
}
