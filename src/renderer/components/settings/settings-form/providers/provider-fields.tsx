import {
  SettingsInput,
  UseFormReturnType
} from '@actovia/shared/schemas/settings-schema'
import { Controller, FieldPath } from 'react-hook-form'

import { Input } from '@/components/ui/input'
import { destinationSecretOf } from '@/lib/secrets'

import { AddressInput, SecretInput } from '../../secret-fields'
import { SettingsRow, SettingsSection } from '../../settings-row'

interface ProviderField {
  name: FieldPath<SettingsInput>
  label: string
  description: string
  placeholder?: string
  type?: 'text' | 'password'
}

interface ProviderFieldsProps {
  form: UseFormReturnType
  fields: ProviderField[]
}

export function ProviderFields({ form, fields }: ProviderFieldsProps) {
  return (
    <SettingsSection>
      {fields.map((field, index) => (
        <Controller
          key={field.name}
          control={form.control}
          name={field.name}
          render={({ field: formField, fieldState }) => (
            <SettingsRow
              label={field.label}
              description={field.description}
              error={fieldState.error}
              layout="vertical"
            >
              {field.type === 'password' ? (
                <SecretInput
                  {...formField}
                  value={formField.value as string | null | undefined}
                  placeholder={field.placeholder}
                  autoFocus={index === 0}
                />
              ) : destinationSecretOf(field.name) ? (
                <AddressInput
                  {...formField}
                  settingsForm={form}
                  isDirty={fieldState.isDirty}
                  placeholder={field.placeholder}
                  autoFocus={index === 0}
                  value={(formField.value as string | null | undefined) ?? ''}
                />
              ) : (
                <Input
                  type="text"
                  placeholder={field.placeholder}
                  autoFocus={index === 0}
                  {...formField}
                  value={formField.value ?? ''}
                />
              )}
            </SettingsRow>
          )}
        />
      ))}
    </SettingsSection>
  )
}
