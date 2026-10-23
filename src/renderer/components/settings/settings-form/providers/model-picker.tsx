import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  CachedModelEntry,
  SettingsInput,
  UseFormReturnType
} from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { isChatModelId } from '@actovia/shared/utils/chat-models'
import {
  fetcher,
  getHttpErrorMessage,
  HttpError,
  toErrorI18n
} from '@actovia/shared/utils/http'
import { AsteroidIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo, useState } from 'react'
import { FieldPath } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList
} from '@/components/ui/combobox'
import { InputGroupAddon } from '@/components/ui/input-group'
import { ENTER } from '@/lib/motion'
import { modelRetirement } from '@/lib/provider-labels'
import { cn } from '@/lib/utils'

import { SettingsRow, SettingsSection } from '../../settings-row'

interface ModelOption {
  value: string
  label: string
  retiresAt?: string | null
}

interface ModelPickerProps {
  provider: AiProviders
  form: UseFormReturnType
  apiKeyField: FieldPath<SettingsInput>
  baseUrlField?: FieldPath<SettingsInput>
  /** Azure only — `providers.azureOpenAiApiVersion`. */
  apiVersionField?: FieldPath<SettingsInput>
}

export function ModelPicker({
  provider,
  form,
  apiKeyField,
  baseUrlField,
  apiVersionField
}: ModelPickerProps) {
  const { t, i18n } = useTranslation(['errors', 'settings'])
  const [loading, setLoading] = useState(false)
  // The key value a refresh was refused for (a saved key cannot go to an
  // unsaved base URL): the inline prompt stays until the key field changes.
  const [refusedKey, setRefusedKey] = useState<string | null>(null)

  const apiKey = form.watch(apiKeyField) as string | undefined
  const baseUrl = baseUrlField
    ? (form.watch(baseUrlField) as string | undefined)
    : undefined
  const apiVersion = apiVersionField
    ? (form.watch(apiVersionField) as string | undefined)
    : undefined

  // Persisted to settings (not just kept in memory) so the catalog survives
  // closing Settings, switching tabs, and even restarting the app — a
  // second visit no longer loses a list the user already fetched, and only
  // an explicit Refresh click ever overwrites this entry. `provider`'s enum
  // values (e.g. "OpenAI GPT") contain spaces but no `.`/`[`/quote
  // characters, so they round-trip safely through react-hook-form's and
  // lodash's dotted-path parsers (both split only on `.[]'"`) as a single
  // path segment.
  const modelCatalogField =
    `modelCatalog.${provider}` as FieldPath<SettingsInput>
  // A catalog saved before the list was cut to chat models still holds the others.
  const fetched =
    (
      form.watch(modelCatalogField) as CachedModelEntry[] | null | undefined
    )?.filter((m) => isChatModelId(m.id)) ?? null

  const activeProvider = form.watch('providerConfig.provider')
  const savedModel =
    activeProvider === provider
      ? (form.watch('providerConfig.model') as string | undefined)
      : undefined

  const options: ModelOption[] =
    fetched?.map((m) => ({
      value: m.id,
      label: m.displayName,
      retiresAt: m.retiresAt
    })) ?? (savedModel ? [{ value: savedModel, label: savedModel }] : [])

  // The saved model may be stale (no longer in the freshest fetched list) —
  // fall back to a synthetic option so the combobox still displays it rather
  // than showing blank.
  const selectedValue: ModelOption | null =
    activeProvider === provider && savedModel
      ? (options.find((o) => o.value === savedModel) ?? {
          value: savedModel,
          label: savedModel
        })
      : null

  // Warning shown when the saved model isn't in the freshest fetched list.
  const staleWarning: string | undefined =
    fetched && savedModel && !fetched.some((m) => m.id === savedModel)
      ? t('settings:providers.model.staleWarning', { model: savedModel })
      : undefined

  const handleRefresh = async () => {
    setLoading(true)
    try {
      const result = await fetcher<{ models: CachedModelEntry[] }>(
        '/api/v1/settings/models',
        {
          method: 'POST',
          body: { provider, apiKey, baseUrl, apiVersion }
        }
      )
      form.setValue(modelCatalogField, result.models, { shouldDirty: true })
      setRefusedKey(null)
    } catch (error) {
      if (
        error instanceof HttpError &&
        error.code === ErrorCode.SECRET_REENTRY_REQUIRED
      ) {
        setRefusedKey(apiKey ?? '')
        return
      }
      sileo.error({
        title: t('settings:providers.model.fetchErrorTitle'),
        description:
          getHttpErrorMessage(error, toErrorI18n(i18n)) ??
          t('settings:providers.model.fetchErrorFallback')
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (id: string) => {
    const model = fetched?.find((m) => m.id === id)
    // All six provider tabs stay navigable regardless of which provider is
    // currently active, but this component only ever shows options for its
    // own `provider` prop. Without this, picking a model from a
    // non-active tab would silently overwrite providerConfig.model with an
    // id that belongs to the wrong provider (the dropdown looks blank
    // because its displayed value is gated on activeProvider === provider,
    // but the write still landed). Selecting a model here always makes this
    // tab's provider the active one, matching provider-config.tsx's own
    // provider-switch handler.
    form.setValue('providerConfig.provider', provider, { shouldDirty: true })
    form.setValue('providerConfig.model', id, { shouldDirty: true })
    form.setValue('providerConfig.modelSnapshot', model?.snapshot ?? null, {
      shouldDirty: true
    })
  }

  const isEmpty = useMemo(() => options.length === 0, [options])

  // A model the provider is shutting down says so after its name, the day
  // itself on hover.
  const retirementLabel = (retiresAt: string | null | undefined) => {
    const state = modelRetirement(retiresAt)
    if (!state || !retiresAt) return null
    const date = new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium'
    }).format(new Date(`${retiresAt}T00:00:00`))
    return (
      <span
        className="text-muted-foreground ml-auto shrink-0 text-xs"
        title={t(`settings:providers.model.${state}On`, { date })}
      >
        {t(`settings:providers.model.${state}`)}
      </span>
    )
  }

  return (
    <SettingsSection>
      <SettingsRow
        label={t('settings:providers.model.label')}
        description={t('settings:providers.model.description')}
      >
        <div className="flex items-center gap-2">
          <Combobox
            items={options}
            itemToStringValue={(item) => item.label}
            value={selectedValue}
            onValueChange={(item) => {
              if (item) handleSelect(item.value)
            }}
            disabled={isEmpty}
          >
            <ComboboxInput
              placeholder={t('settings:providers.model.searchPlaceholder')}
              disabled={isEmpty}
              data-testid={TEST_IDS.providerModels.modelSelect}
            >
              <InputGroupAddon>
                <HugeiconsIcon icon={AsteroidIcon} />
              </InputGroupAddon>
            </ComboboxInput>
            <ComboboxContent>
              <ComboboxEmpty>
                {t('settings:providers.model.noModelsFound')}
              </ComboboxEmpty>
              <ComboboxList>
                {(item) => (
                  <ComboboxItem key={item.value} value={item}>
                    <span className="truncate">{item.label}</span>
                    {retirementLabel(item.retiresAt)}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <Button
            type="button"
            variant="outline"
            data-testid={TEST_IDS.providerModels.refreshButton}
            disabled={!apiKey || loading}
            onClick={handleRefresh}
          >
            {loading
              ? isEmpty
                ? t('settings:providers.model.retrieving')
                : t('settings:providers.model.refreshing')
              : isEmpty
                ? t('settings:providers.model.retrieve')
                : t('settings:providers.model.refresh')}
          </Button>
        </div>
        {!fetched && savedModel && (
          <p className="text-muted-foreground text-xs">
            {t('settings:providers.model.refreshHint')}
          </p>
        )}
        {staleWarning && (
          <p className="text-destructive text-xs">{staleWarning}</p>
        )}
        {refusedKey !== null && refusedKey === (apiKey ?? '') && (
          <p
            className={cn('text-destructive text-xs', ENTER)}
            data-testid={TEST_IDS.providerModels.reenterError}
          >
            {t('settings:providers.model.reenterKey')}
          </p>
        )}
      </SettingsRow>
    </SettingsSection>
  )
}
