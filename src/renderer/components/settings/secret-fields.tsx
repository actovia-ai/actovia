import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type {
  SettingsInput,
  UseFormReturnType
} from '@actovia/shared/schemas/settings-schema'
import { useAtom } from 'jotai'
import type React from 'react'
import { useId, useState } from 'react'
import { type FieldPath, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'
import { useSecretsStatus } from '@/hooks/use-secrets-status'
import { ENTER } from '@/lib/motion'
import { destinationSecretOf, looksLikeMask, replaceMask } from '@/lib/secrets'
import { cn } from '@/lib/utils'
import { clearedSecretsAtom } from '@/stores/secrets'

type SecretInputProps = Omit<
  React.ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'name'
> & {
  /** The settings path (`providers.openaiApiKey`). */
  name: string
  value: string | null | undefined
  onChange: (value: string) => void
}

/**
 * A stored key's input. The API hands a saved key out as its mask
 * (`•••• abcd`), shown as text so its last four read; typing replaces the
 * whole mask, deleting from it clears the key. The autosave posts whatever
 * the field holds — an untouched mask means "unchanged" to the server. A key
 * the user types is a password field as before.
 */
export function SecretInput({
  name,
  value,
  onChange,
  onFocus,
  ...props
}: SecretInputProps) {
  const { t } = useTranslation('settings')
  const [cleared, setCleared] = useAtom(clearedSecretsAtom)
  const { data: status } = useSecretsStatus()
  const masked = looksLikeMask(value)
  const statusId = useId()
  // What a screen reader hears instead of "bullet bullet bullet bullet".
  const spoken = masked
    ? value.length > 4
      ? t('secrets.input.savedAria', { last4: value.slice(-4) })
      : t('secrets.input.savedShortAria')
    : value
      ? null
      : t('secrets.input.noneAria')
  const needsKey =
    !value && (cleared.includes(name) || !!status?.needsReentry.includes(name))

  return (
    <>
      <InputGroup>
        <InputGroupInput
          {...props}
          name={name}
          type={masked ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          value={value ?? ''}
          data-testid={TEST_IDS.secrets.keyInput}
          data-field={name}
          data-masked={masked || undefined}
          aria-label={masked ? (spoken ?? undefined) : props['aria-label']}
          aria-describedby={spoken ? statusId : undefined}
          onFocus={(e) => {
            // Selected, so the first key typed (or a paste) replaces the mask.
            if (masked) e.currentTarget.select()
            onFocus?.(e)
          }}
          onChange={(e) => {
            const next = masked
              ? replaceMask(value, e.target.value)
              : e.target.value
            if (next && cleared.includes(name)) {
              setCleared((prev) => prev.filter((p) => p !== name))
            }
            onChange(next)
          }}
        />
        {masked && (
          <InputGroupAddon align="inline-end">
            <InputGroupText className="text-xs">
              {t('secrets.input.saved')}
            </InputGroupText>
          </InputGroupAddon>
        )}
      </InputGroup>
      {spoken && (
        <span id={statusId} className="sr-only">
          {spoken}
        </span>
      )}
      {needsKey && (
        <p
          className={cn('text-destructive text-xs', ENTER)}
          data-testid={TEST_IDS.secrets.reenterPrompt}
        >
          {t('secrets.input.reenter')}
        </p>
      )}
    </>
  )
}

type DestinationInputProps = React.ComponentProps<typeof Input> & {
  /** A saved secret is sent to this address: changing it clears the secret. */
  guarded: boolean
  /** An edit not saved yet. */
  isDirty?: boolean
  /** What the change clears — shown from focus until the edit is saved. */
  hint: string
}

/**
 * An address (or command) a saved secret is sent to. Changing it clears the
 * secret on save — it never follows a new host or process — so the field
 * says so from the moment it is focused, and while its edit is unsaved:
 * before the save, not after. Used by the Settings form (`AddressInput`) and
 * the MCP form (url, command).
 */
export function DestinationInput({
  guarded,
  isDirty,
  hint,
  onFocus,
  onBlur,
  ...props
}: DestinationInputProps) {
  const [focused, setFocused] = useState(false)
  const hintId = useId()
  const showHint = guarded && (focused || !!isDirty)
  // A screen reader hears the warning as the field's description whenever it
  // applies — not only once it is painted on focus, which would come too late.
  const describedBy =
    [props['aria-describedby'], guarded ? hintId : undefined]
      .filter(Boolean)
      .join(' ') || undefined
  return (
    <>
      <Input
        {...props}
        aria-describedby={describedBy}
        onFocus={(e) => {
          setFocused(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          onBlur?.(e)
        }}
      />
      {showHint ? (
        <p
          id={hintId}
          className={cn('text-muted-foreground text-xs', ENTER)}
          data-testid={TEST_IDS.secrets.destinationHint}
        >
          {hint}
        </p>
      ) : (
        guarded && (
          <span id={hintId} className="sr-only">
            {hint}
          </span>
        )
      )}
    </>
  )
}

type AddressInputProps = Omit<React.ComponentProps<typeof Input>, 'form'> & {
  settingsForm: UseFormReturnType
  /** The address field's settings path (`providers.openaiBaseUrl`). */
  name: FieldPath<SettingsInput>
  /** From the Controller's `fieldState`: an edit not saved yet. */
  isDirty?: boolean
}

/**
 * A Settings address a stored key is sent to (a provider base URL, the Azure
 * endpoint, LightRAG): a `DestinationInput` guarded while that
 * key is saved (shown as its mask).
 */
export function AddressInput({
  settingsForm,
  name,
  isDirty,
  ...props
}: AddressInputProps) {
  const { t } = useTranslation('settings')
  const secret = destinationSecretOf(name)
  const key = useWatch({
    control: settingsForm.control,
    name: (secret ?? name) as FieldPath<SettingsInput>
  })
  return (
    <DestinationInput
      {...props}
      name={name}
      guarded={!!secret && looksLikeMask(key)}
      isDirty={isDirty}
      hint={t('secrets.destinationHint')}
    />
  )
}
