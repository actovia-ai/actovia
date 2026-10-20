import { languageCodes } from '@actovia/shared/constants/language-codes'
import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { useMemo } from 'react'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Flag } from '@/components/app/flag'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor
} from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { InputGroupAddon } from '@/components/ui/input-group'
import { Switch } from '@/components/ui/switch'
import { countryOptions } from '@/lib/country-names'

import { SecretInput } from '../secret-fields'
import { SettingsRow, SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'

type OptionItem = { label: string; value: string }

const languageItems: OptionItem[] = languageCodes.map((l) => ({
  label: l.language,
  value: l.languageCode
}))

export function WebSearch({ form }: { form: UseFormReturnType }) {
  const { t, i18n } = useTranslation('settings')
  // Named in the user's language (see country-names.ts); the label is what
  // the combobox searches and shows in its input, the flag sits beside it.
  const countryItems = useMemo(
    () =>
      countryOptions(i18n.resolvedLanguage ?? i18n.language ?? 'en').map(
        (c) => ({ label: c.name, value: c.code })
      ),
    [i18n.resolvedLanguage, i18n.language]
  )
  const languageChipsAnchor = useComboboxAnchor()

  const recencyOptions = useMemo(
    () => [
      { value: 'none', label: t('tools.webSearch.recency.options.none') },
      { value: 'hour', label: t('tools.webSearch.recency.options.hour') },
      { value: 'day', label: t('tools.webSearch.recency.options.day') },
      { value: 'week', label: t('tools.webSearch.recency.options.week') },
      { value: 'month', label: t('tools.webSearch.recency.options.month') },
      { value: 'year', label: t('tools.webSearch.recency.options.year') }
    ],
    [t]
  )

  return (
    <SettingsSection plain>
      {/* API Key */}
      <Controller
        control={form.control}
        name="webSearch.braveApiKey"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('tools.webSearch.apiKey.label')}
            description={t('tools.webSearch.apiKey.description')}
            error={fieldState.error}
            layout="vertical"
          >
            <SecretInput placeholder="BSA..." {...field} value={field.value} />
          </SettingsRow>
        )}
      />

      {/* Country */}
      <Controller
        control={form.control}
        name="webSearch.country"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('tools.webSearch.country.label')}
            description={t('tools.webSearch.country.description')}
            error={fieldState.error}
          >
            <Combobox
              items={countryItems}
              itemToStringValue={(item) => item.label}
              value={
                field.value
                  ? (countryItems.find((c) => c.value === field.value) ?? null)
                  : null
              }
              onValueChange={(item) =>
                form.setValue('webSearch.country', item?.value ?? null)
              }
            >
              <ComboboxInput
                placeholder={t('tools.webSearch.country.placeholder')}
                showClear
                className="w-64"
              >
                {field.value && (
                  <InputGroupAddon align="inline-start">
                    <Flag code={field.value} />
                  </InputGroupAddon>
                )}
              </ComboboxInput>
              <ComboboxContent className="w-72">
                <ComboboxEmpty>
                  {t('tools.webSearch.country.empty')}
                </ComboboxEmpty>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem key={item.value} value={item}>
                      <Flag code={item.value} />
                      <span className="truncate">{item.label}</span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </SettingsRow>
        )}
      />

      {/* Languages (multi-select with chips) */}
      <Controller
        control={form.control}
        name="webSearch.languages"
        render={({ field, fieldState }) => {
          const selectedItems = (field.value ?? []).flatMap((code: string) => {
            const item = languageItems.find((l) => l.value === code)
            return item ? [item] : []
          }) as OptionItem[]
          return (
            <SettingsRow
              label={t('tools.webSearch.languages.label')}
              description={t('tools.webSearch.languages.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <Combobox
                multiple
                value={selectedItems}
                onValueChange={(items) =>
                  form.setValue(
                    'webSearch.languages',
                    items.length > 0 ? items.map((i) => i.value) : null
                  )
                }
                items={languageItems}
                itemToStringValue={(item) => item.label}
              >
                <ComboboxChips ref={languageChipsAnchor}>
                  {selectedItems.map((item) => (
                    <ComboboxChip key={item.value}>{item.label}</ComboboxChip>
                  ))}
                  <ComboboxChipsInput
                    placeholder={t('tools.webSearch.languages.placeholder')}
                  />
                </ComboboxChips>
                <ComboboxContent anchor={languageChipsAnchor}>
                  <ComboboxEmpty>
                    {t('tools.webSearch.languages.empty')}
                  </ComboboxEmpty>
                  <ComboboxList>
                    {(item) => (
                      <ComboboxItem key={item.value} value={item}>
                        {item.label}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </SettingsRow>
          )
        }}
      />

      {/* Max Results */}
      <Controller
        control={form.control}
        name="webSearch.maxResults"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('tools.webSearch.maxResults.label')}
            description={t('tools.webSearch.maxResults.description')}
            error={fieldState.error}
          >
            <Input
              type="number"
              min={1}
              max={50}
              className="w-20"
              placeholder="10"
              {...field}
              value={field.value ?? ''}
              onChange={(e) => {
                const v = e.target.value
                field.onChange(v === '' ? null : Number(v))
              }}
            />
          </SettingsRow>
        )}
      />

      {/* Deep Recall */}
      <Controller
        control={form.control}
        name="webSearch.deepRecall"
        render={({ field }) => (
          <SettingsRow
            label={t('tools.webSearch.deepRecall.label')}
            description={t('tools.webSearch.deepRecall.description')}
          >
            {/* Off unless switched on, as the search tool reads it. */}
            <Switch
              checked={field.value ?? false}
              onCheckedChange={field.onChange}
            />
          </SettingsRow>
        )}
      />

      {/* Recency Filter */}
      <Controller
        control={form.control}
        name="webSearch.recencyFilter"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('tools.webSearch.recency.label')}
            description={t('tools.webSearch.recency.description')}
            error={fieldState.error}
          >
            <SettingsSelect
              value={field.value ?? 'none'}
              onValueChange={(val) =>
                form.setValue(
                  'webSearch.recencyFilter',
                  val === 'none'
                    ? null
                    : (val as 'hour' | 'day' | 'week' | 'month' | 'year')
                )
              }
              options={recencyOptions}
              placeholder={t('tools.webSearch.recency.options.none')}
            />
          </SettingsRow>
        )}
      />

      {/* Domain Filter */}
      <Controller
        control={form.control}
        name="webSearch.domainFilter"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('tools.webSearch.domainFilter.label')}
            description={t('tools.webSearch.domainFilter.description')}
            error={fieldState.error}
            layout="vertical"
          >
            <Input
              placeholder="e.g. nature.com, .edu, -reddit.com"
              {...field}
              value={field.value ?? ''}
            />
          </SettingsRow>
        )}
      />
    </SettingsSection>
  )
}
