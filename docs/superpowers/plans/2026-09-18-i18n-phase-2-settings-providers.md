# i18n Phase 2 — settings-providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the third slice of the `settings` namespace: the AI
Providers tab family — the provider dropdown + tab chrome
(`provider-config.tsx`, `providers-tabs.tsx`), the four near-identical
simple provider forms (OpenAI, Anthropic, Gemini, Grok), Azure OpenAI's
extra fields, Ollama's extra fields, and the shared `ModelPicker`. As a
drive-by fix (since this plan touches the exact file), also close the
long-standing orphan test-id gap in `model-picker.tsx`
(`TEST_IDS.providerModels.modelSelect` — declared and referenced by a real
Playwright test since before this whole i18n effort started, but never
applied to an element) and remove the now-resolved standing `--no-verify`
exception from CLAUDE.md.

**Architecture:** `AiProviders` enum values (`'OpenAI GPT'`, `'Azure OpenAI'`,
`'Anthropic Claude'`, `'Google Gemini'`, `'xAI Grok'`, `'Ollama'`) and the
tab labels in `providers-tabs.tsx`'s `PROVIDER_TABS` (`'OpenAI'`, `'Azure'`,
`'Claude'`, `'Gemini'`, `'Grok'`, `'Ollama'`) are proper nouns / product
names — like `settings-core`'s `actovia-ai/actovia`/`MIT`/`AWS S3`, these
stay hardcoded in every locale, never routed through `t()`. Likewise every
placeholder that's an API-key-format hint or a URL/version-string example
(`sk-...`, `AIza...`, `https://api.openai.com/v1`, `2024-12-01-preview`,
etc.) is a technical value, not language — stays hardcoded. What DOES need
translation: every row `label`/`description`, section titles, button text,
empty/loading states, and one interpolated template
(`providers.fields.apiKey.description: "Your {{provider}} API key"`) that
takes the (untranslated, proper-noun) provider name as a parameter — this
is the same "proper noun interpolated into translated surrounding text"
pattern used throughout this project. `provider-fields.tsx` itself needs
zero changes — it's a fully generic renderer that only displays whatever
`label`/`description`/`placeholder` strings its `fields` prop gives it;
translation happens at each per-provider call site, which is why "API
Key"/"Base URL" become ONE shared catalog key each (`providers.fields.
apiKey.*`/`providers.fields.baseUrl.*`) instead of being duplicated five
times.

**Tech Stack:** i18next + react-i18next (already wired).

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- Catalog key: `src/shared/i18n/locales/en/settings.json`, new
  `providers.*` top-level block, dot-nested, English source text only.
- Every file in this plan is single-namespace `useTranslation('settings')`
  — none of them currently import `useTranslation` (fresh additions, not
  array-form conversions), except `model-picker.tsx` which already has
  `useTranslation('errors')` and needs the array form
  `useTranslation(['errors', 'settings'])` (keep `errors` first so its
  existing bare `i18n` destructure — used via `toErrorI18n(i18n)`, not
  `t()` — is untouched; every NEW lookup gets the `settings:` prefix).
- `AiProviders` enum values and `providers-tabs.tsx`'s tab `label`s are
  proper nouns — never wrapped in `t()`, never added to the catalog.
  Likewise every API-key-format/URL/version-string placeholder value.
- Never `git commit --amend`. `git add` scoped to the exact files each
  task names — never `-A`/`.` (shared, concurrently-edited working tree).
- `pnpm i18n:check` / `pnpm typecheck` / `pnpm lint` / `pnpm test` must
  pass before any commit. Once Task 5 closes the orphan-id gap, `pnpm
  test` should pass with ZERO exceptions for the first time in this whole
  i18n effort — verify that before assuming the standing `--no-verify`
  justification still applies to any later commit in this plan.
- Commit the plan document itself before considering this plan finished.
- Run the isolated committed-tree check (`git archive HEAD | tar -x` into
  a scratch dir, symlink `node_modules`, then
  `./node_modules/.bin/tsc --noEmit -p tsconfig.web.json --composite false`
  and the `tsconfig.node.json` equivalent, called directly — not via
  `pnpm exec`, which fails pnpm's workspace-root sanity check from outside
  the real project root) before requesting final review.

---

## Task 1: Provider dropdown + tab chrome

**Files:**

- Modify: `src/renderer/components/settings/settings-form/provider-config.tsx` (full rewrite — clean file)
- Modify: `src/renderer/components/settings/settings-form/providers-tabs.tsx` (full rewrite — clean file)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `providers.config.*` and `providers.keys.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (add a test block)

**Interfaces:** Produces nothing consumed by later tasks — independent of
the per-provider files.

- [ ] **Step 1: Rewrite `provider-config.tsx`**

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { AiProviders } from '@shared/types/ai'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { SettingsRow, SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'

const providerOptions = Object.values(AiProviders).map((val) => ({
  value: val,
  label: val
}))

export function ProviderConfig({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <SettingsSection>
      <Controller
        control={form.control}
        name="providerConfig.provider"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('providers.config.label')}
            description={t('providers.config.description')}
            error={fieldState.error}
          >
            <SettingsSelect
              value={field.value ?? ''}
              onValueChange={(value) => {
                field.onChange(value)
                form.setValue('providerConfig.model', '')
                form.setValue('providerConfig.modelSnapshot', null)
              }}
              options={providerOptions}
              placeholder={t('providers.config.placeholder')}
            />
          </SettingsRow>
        )}
      />
    </SettingsSection>
  )
}
```

`providerOptions`' `label: val` stays the raw `AiProviders` enum value
(a proper noun like `"OpenAI GPT"`) — unchanged, not translated.

- [ ] **Step 2: Rewrite `providers-tabs.tsx`**

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { AiProviders } from '@shared/types/ai'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { SettingsSection } from '../settings-row'
import { ProviderConfig } from './provider-config'
import { AnthropicClaude } from './providers/anthropic-claude'
import { AzureOpenAi } from './providers/azure-openai'
import { GoogleGemini } from './providers/google-gemini'
import { Ollama } from './providers/ollama'
import { OpenAiGpt } from './providers/openai-gpt'
import { XaiGrok } from './providers/xai-grok'

const PROVIDER_TABS = [
  { value: 'openai', label: 'OpenAI', Component: OpenAiGpt },
  { value: 'azure', label: 'Azure', Component: AzureOpenAi },
  { value: 'claude', label: 'Claude', Component: AnthropicClaude },
  { value: 'gemini', label: 'Gemini', Component: GoogleGemini },
  { value: 'grok', label: 'Grok', Component: XaiGrok },
  { value: 'ollama', label: 'Ollama', Component: Ollama }
] as const

type ProviderTab = (typeof PROVIDER_TABS)[number]['value']

/**
 * Maps the "Provider" dropdown selection (an `AiProviders` enum value) onto
 * the matching "Provider keys" tab, so picking a provider above jumps the
 * tabs below straight to its key fields.
 */
const PROVIDER_TO_TAB: Record<AiProviders, ProviderTab> = {
  [AiProviders.OpenAiGpt]: 'openai',
  [AiProviders.AzureOpenAi]: 'azure',
  [AiProviders.AnthropicClaude]: 'claude',
  [AiProviders.GoogleGemini]: 'gemini',
  [AiProviders.XaiGrok]: 'grok',
  [AiProviders.Ollama]: 'ollama'
}

export function ProvidersTabs({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const provider = form.watch('providerConfig.provider')
  const [tab, setTab] = useState<ProviderTab>(
    () => PROVIDER_TO_TAB[provider as AiProviders] ?? 'openai'
  )

  // Follow the Provider dropdown: selecting a provider above jumps the key
  // tabs to it. Manual tab clicks still work — this only reacts when the
  // dropdown value itself changes.
  useEffect(() => {
    const next = PROVIDER_TO_TAB[provider as AiProviders]
    if (next) setTab(next)
  }, [provider])

  return (
    <div className="flex flex-col gap-8">
      <ProviderConfig form={form} />

      <SettingsSection title={t('providers.keys.sectionTitle')} plain>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as ProviderTab)}
          className="gap-5"
        >
          <TabsList className="w-full">
            {PROVIDER_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {PROVIDER_TABS.map(({ value, Component }) => (
            <TabsContent
              key={value}
              value={value}
              className="flex flex-col gap-5"
            >
              <Component form={form} />
            </TabsContent>
          ))}
        </Tabs>
      </SettingsSection>
    </div>
  )
}
```

Note: `PROVIDER_TABS.map((t) => ...)` inside the `TabsList` render shadows
the outer `t` (the translation function) with the loop's tab-descriptor
variable — exactly the shadowing hazard CLAUDE.md's step 8 warns about.
This is SAFE here only because the shadowed `t` is never referenced inside
that specific `.map()` callback (`t.value`/`t.label` are the tab
descriptor's own fields, not calls to the translation function) — but it
is fragile: do not add a `t('...')` call inside that particular `.map()`
callback without first renaming its parameter (e.g. to `tabDef`). Leave
the existing `PROVIDER_TABS.map((t) => ...)` name as-is per this plan's
byte-exact content (it was already named `t` before this task); do not
rename it as part of this task — flag it only for whoever next edits
this file.

- [ ] **Step 3: Add `providers.config.*` and `providers.keys.*` to `settings.json`**

Find (the end of the file, `profile.avatar`'s closing — the block Task 2
of `settings-profile` added):

```
    "avatar": {
      "uploadLabel": "Upload your avatar",
      "alt": "Your avatar"
    }
  }
}
```

Replace with:

```
    "avatar": {
      "uploadLabel": "Upload your avatar",
      "alt": "Your avatar"
    }
  },
  "providers": {
    "config": {
      "label": "Provider",
      "description": "The AI provider to use for chat",
      "placeholder": "Select a provider"
    },
    "keys": {
      "sectionTitle": "Provider keys"
    }
  }
}
```

- [ ] **Step 4: Add a test**

Find (the end of the `'has the Profile tab keys'` test body):

```
    expect(settings.profile.avatar).toMatchObject({
      uploadLabel: 'Upload your avatar',
      alt: 'Your avatar'
    })
  })
})
```

Replace with:

```
    expect(settings.profile.avatar).toMatchObject({
      uploadLabel: 'Upload your avatar',
      alt: 'Your avatar'
    })
  })

  it('has the provider dropdown and tab-chrome keys', () => {
    expect(settings.providers.config).toMatchObject({
      label: 'Provider',
      description: 'The AI provider to use for chat',
      placeholder: 'Select a provider'
    })
    expect(settings.providers.keys.sectionTitle).toBe('Provider keys')
  })
})
```

- [ ] **Step 5: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/settings/settings-form/provider-config.tsx \
  src/renderer/components/settings/settings-form/providers-tabs.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the provider dropdown and tab chrome"
```

---

## Task 2: The four simple provider forms (OpenAI, Anthropic, Gemini, Grok)

**Files:**

- Modify: `src/renderer/components/settings/settings-form/providers/openai-gpt.tsx` (full rewrite — clean file)
- Modify: `src/renderer/components/settings/settings-form/providers/anthropic-claude.tsx` (full rewrite — clean file)
- Modify: `src/renderer/components/settings/settings-form/providers/google-gemini.tsx` (full rewrite — clean file)
- Modify: `src/renderer/components/settings/settings-form/providers/xai-grok.tsx` (full rewrite — clean file)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `providers.fields.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (add a test block)

**Interfaces:** These four files are batched together because they're
near-identical in shape (same "same-shape work" as the plan's own
process notes) — each just supplies `ProviderFields` two entries (API
Key, Base URL) and renders `ModelPicker`. Produces the shared
`providers.fields.apiKey.*`/`providers.fields.baseUrl.*` keys that Task 3
(Azure) also reuses for its own API-key field.

- [ ] **Step 1: Rewrite `openai-gpt.tsx`**

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { AiProviders } from '@shared/types/ai'
import { useTranslation } from 'react-i18next'

import { ModelPicker } from './model-picker'
import { ProviderFields } from './provider-fields'

export function OpenAiGpt({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <>
      <ProviderFields
        form={form}
        fields={[
          {
            name: 'providers.openaiApiKey',
            label: t('providers.fields.apiKey.label'),
            description: t('providers.fields.apiKey.description', {
              provider: AiProviders.OpenAiGpt
            }),
            placeholder: 'sk-...',
            type: 'password'
          },
          {
            name: 'providers.openaiBaseUrl',
            label: t('providers.fields.baseUrl.label'),
            description: t('providers.fields.baseUrl.description'),
            placeholder: 'https://api.openai.com/v1'
          }
        ]}
      />
      <ModelPicker
        provider={AiProviders.OpenAiGpt}
        form={form}
        apiKeyField="providers.openaiApiKey"
        baseUrlField="providers.openaiBaseUrl"
      />
    </>
  )
}
```

- [ ] **Step 2: Rewrite `anthropic-claude.tsx`**

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { AiProviders } from '@shared/types/ai'
import { useTranslation } from 'react-i18next'

import { ModelPicker } from './model-picker'
import { ProviderFields } from './provider-fields'

export function AnthropicClaude({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <>
      <ProviderFields
        form={form}
        fields={[
          {
            name: 'providers.anthropicApiKey',
            label: t('providers.fields.apiKey.label'),
            description: t('providers.fields.apiKey.description', {
              provider: AiProviders.AnthropicClaude
            }),
            placeholder: 'sk-ant-...',
            type: 'password'
          },
          {
            name: 'providers.anthropicBaseUrl',
            label: t('providers.fields.baseUrl.label'),
            description: t('providers.fields.baseUrl.description'),
            placeholder: 'https://api.anthropic.com'
          }
        ]}
      />
      <ModelPicker
        provider={AiProviders.AnthropicClaude}
        form={form}
        apiKeyField="providers.anthropicApiKey"
        baseUrlField="providers.anthropicBaseUrl"
      />
    </>
  )
}
```

- [ ] **Step 3: Rewrite `google-gemini.tsx`**

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { AiProviders } from '@shared/types/ai'
import { useTranslation } from 'react-i18next'

import { ModelPicker } from './model-picker'
import { ProviderFields } from './provider-fields'

export function GoogleGemini({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <>
      <ProviderFields
        form={form}
        fields={[
          {
            name: 'providers.googleGeminiApiKey',
            label: t('providers.fields.apiKey.label'),
            description: t('providers.fields.apiKey.description', {
              provider: AiProviders.GoogleGemini
            }),
            placeholder: 'AIza...',
            type: 'password'
          },
          {
            name: 'providers.googleGeminiBaseUrl',
            label: t('providers.fields.baseUrl.label'),
            description: t('providers.fields.baseUrl.description'),
            placeholder: 'https://generativelanguage.googleapis.com'
          }
        ]}
      />
      <ModelPicker
        provider={AiProviders.GoogleGemini}
        form={form}
        apiKeyField="providers.googleGeminiApiKey"
        baseUrlField="providers.googleGeminiBaseUrl"
      />
    </>
  )
}
```

- [ ] **Step 4: Rewrite `xai-grok.tsx`**

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { AiProviders } from '@shared/types/ai'
import { useTranslation } from 'react-i18next'

import { ModelPicker } from './model-picker'
import { ProviderFields } from './provider-fields'

export function XaiGrok({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <>
      <ProviderFields
        form={form}
        fields={[
          {
            name: 'providers.xAiApiKey',
            label: t('providers.fields.apiKey.label'),
            description: t('providers.fields.apiKey.description', {
              provider: AiProviders.XaiGrok
            }),
            placeholder: 'xai-...',
            type: 'password'
          },
          {
            name: 'providers.xAiBaseUrl',
            label: t('providers.fields.baseUrl.label'),
            description: t('providers.fields.baseUrl.description'),
            placeholder: 'https://api.x.ai/v1'
          }
        ]}
      />
      <ModelPicker
        provider={AiProviders.XaiGrok}
        form={form}
        apiKeyField="providers.xAiApiKey"
        baseUrlField="providers.xAiBaseUrl"
      />
    </>
  )
}
```

- [ ] **Step 5: Add `providers.fields.*` to `settings.json`**

Find (the `providers.keys` block Task 1 added, closing the file):

```
    "keys": {
      "sectionTitle": "Provider keys"
    }
  }
}
```

Replace with:

```
    "keys": {
      "sectionTitle": "Provider keys"
    },
    "fields": {
      "apiKey": {
        "label": "API Key",
        "description": "Your {{provider}} API key"
      },
      "baseUrl": {
        "label": "Base URL",
        "description": "Custom API endpoint. Leave empty for default"
      }
    }
  }
}
```

- [ ] **Step 6: Add a test**

Find (the end of the `'has the provider dropdown and tab-chrome keys'` test body):

```
    expect(settings.providers.keys.sectionTitle).toBe('Provider keys')
  })
})
```

Replace with:

```
    expect(settings.providers.keys.sectionTitle).toBe('Provider keys')
  })

  it('has the shared provider field keys', () => {
    expect(settings.providers.fields.apiKey).toMatchObject({
      label: 'API Key',
      description: 'Your {{provider}} API key'
    })
    expect(settings.providers.fields.baseUrl).toMatchObject({
      label: 'Base URL',
      description: 'Custom API endpoint. Leave empty for default'
    })
  })
})
```

- [ ] **Step 7: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/settings/settings-form/providers/openai-gpt.tsx \
  src/renderer/components/settings/settings-form/providers/anthropic-claude.tsx \
  src/renderer/components/settings/settings-form/providers/google-gemini.tsx \
  src/renderer/components/settings/settings-form/providers/xai-grok.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the OpenAI/Anthropic/Gemini/Grok provider forms"
```

---

## Task 3: Azure OpenAI's extra fields

**Files:**

- Modify: `src/renderer/components/settings/settings-form/providers/azure-openai.tsx` (full rewrite — clean file)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `providers.azure.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (add a test block)

**Interfaces:** Consumes `providers.fields.apiKey.*` from Task 2 for its
own API-key field (same interpolated template, just with
`AiProviders.AzureOpenAi` as the param).

- [ ] **Step 1: Rewrite `azure-openai.tsx`**

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { AiProviders } from '@shared/types/ai'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'

import { SettingsRow, SettingsSection } from '../../settings-row'
import { ProviderFields } from './provider-fields'

export function AzureOpenAi({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <>
      <ProviderFields
        form={form}
        fields={[
          {
            name: 'providers.azureOpenaiApiKey',
            label: t('providers.fields.apiKey.label'),
            description: t('providers.fields.apiKey.description', {
              provider: AiProviders.AzureOpenAi
            }),
            type: 'password'
          },
          {
            name: 'providers.azureOpenAiEndpoint',
            label: t('providers.azure.endpoint.label'),
            description: t('providers.azure.endpoint.description'),
            placeholder:
              'https://{resource}.openai.azure.com/openai/deployments/{model}'
          },
          {
            name: 'providers.azureOpenAiApiVersion',
            label: t('providers.azure.apiVersion.label'),
            description: t('providers.azure.apiVersion.description'),
            placeholder: '2024-12-01-preview'
          }
        ]}
      />
      {/* Azure has no live model-list fetch (see list-models/ — unverified
          against a real Azure resource), so this stays a plain text input
          instead of ModelPicker's dropdown. Pulled out of the ProviderFields
          array above (unlike its siblings) because it needs its own
          onChange side effect below. */}
      <SettingsSection>
        <Controller
          control={form.control}
          name="providerConfig.model"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('providers.azure.model.label')}
              description={t('providers.azure.model.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <Input
                type="text"
                placeholder="gpt-5.6"
                {...field}
                value={field.value ?? ''}
                onChange={(e) => {
                  field.onChange(e)
                  // Same rule as ModelPicker's handleSelect for the other,
                  // live-fetch providers: setting a model here always makes
                  // Azure the active provider, so this free-text field can't
                  // silently corrupt providerConfig.model while a different
                  // provider tab is active. modelSnapshot is cleared too —
                  // Azure has no live-snapshot concept, and leaving a stale
                  // snapshot from a previously-active provider around would
                  // confuse resolveModel().
                  form.setValue(
                    'providerConfig.provider',
                    AiProviders.AzureOpenAi,
                    { shouldDirty: true }
                  )
                  form.setValue('providerConfig.modelSnapshot', null, {
                    shouldDirty: true
                  })
                }}
              />
            </SettingsRow>
          )}
        />
      </SettingsSection>
    </>
  )
}
```

- [ ] **Step 2: Add `providers.azure.*` to `settings.json`**

Find (the `providers.fields` block Task 2 added, closing the file):

```
    "fields": {
      "apiKey": {
        "label": "API Key",
        "description": "Your {{provider}} API key"
      },
      "baseUrl": {
        "label": "Base URL",
        "description": "Custom API endpoint. Leave empty for default"
      }
    }
  }
}
```

Replace with:

```
    "fields": {
      "apiKey": {
        "label": "API Key",
        "description": "Your {{provider}} API key"
      },
      "baseUrl": {
        "label": "Base URL",
        "description": "Custom API endpoint. Leave empty for default"
      }
    },
    "azure": {
      "endpoint": {
        "label": "Endpoint",
        "description": "Your Azure OpenAI resource endpoint URL"
      },
      "apiVersion": {
        "label": "API Version",
        "description": "Azure OpenAI API version string"
      },
      "model": {
        "label": "Model",
        "description": "The Azure deployment name to use"
      }
    }
  }
}
```

- [ ] **Step 3: Add a test**

Find (the end of the `'has the shared provider field keys'` test body):

```
    expect(settings.providers.fields.baseUrl).toMatchObject({
      label: 'Base URL',
      description: 'Custom API endpoint. Leave empty for default'
    })
  })
})
```

Replace with:

```
    expect(settings.providers.fields.baseUrl).toMatchObject({
      label: 'Base URL',
      description: 'Custom API endpoint. Leave empty for default'
    })
  })

  it('has the Azure-specific provider field keys', () => {
    expect(settings.providers.azure.endpoint).toMatchObject({
      label: 'Endpoint',
      description: 'Your Azure OpenAI resource endpoint URL'
    })
    expect(settings.providers.azure.apiVersion).toMatchObject({
      label: 'API Version',
      description: 'Azure OpenAI API version string'
    })
    expect(settings.providers.azure.model).toMatchObject({
      label: 'Model',
      description: 'The Azure deployment name to use'
    })
  })
})
```

- [ ] **Step 4: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/settings-form/providers/azure-openai.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the Azure OpenAI provider form"
```

---

## Task 4: Ollama's extra fields

**Files:**

- Modify: `src/renderer/components/settings/settings-form/providers/ollama.tsx` (full rewrite — clean file)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `providers.ollama.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (add a test block)

**Interfaces:** Independent of Tasks 2-3 (Ollama doesn't use
`ProviderFields`/the shared `apiKey`/`baseUrl` templates at all — it has
its own Base URL field with a provider-specific description, since Ollama
has no "default" endpoint concept the way the cloud providers do).

- [ ] **Step 1: Rewrite `ollama.tsx`**

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { AiProviders } from '@shared/types/ai'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { Input } from '@/components/ui/input'
import { useSettings } from '@/hooks/use-settings'

import { SettingsRow, SettingsSection } from '../../settings-row'
import { ModelPicker } from './model-picker'

export function Ollama({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const { data: settings } = useSettings()
  const { error } = useSWR(
    settings?.providers?.ollamaBaseUrl
      ? `/api/tools/ping-ollama?url=${settings?.providers?.ollamaBaseUrl}`
      : null
  )

  const isRunning = !!settings?.providers?.ollamaBaseUrl && error === undefined

  return (
    <>
      <SettingsSection>
        <Controller
          control={form.control}
          name="providers.ollamaBaseUrl"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('providers.ollama.baseUrl.label')}
              description={t('providers.ollama.baseUrl.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <Input
                type="text"
                placeholder="http://localhost:11434"
                autoFocus
                {...field}
                value={field.value ?? ''}
              />
            </SettingsRow>
          )}
        />
        <SettingsRow
          label={t('providers.ollama.status.label')}
          description={t('providers.ollama.status.description')}
        >
          <div className="flex items-center gap-2">
            <div
              className={`h-3 w-3 rounded-full ${isRunning ? 'bg-green-400' : 'bg-red-400'}`}
            />
            <p className="text-sm">
              {isRunning
                ? t('providers.ollama.status.running')
                : t('providers.ollama.status.notRunning')}
            </p>
          </div>
        </SettingsRow>
      </SettingsSection>
      <ModelPicker
        provider={AiProviders.Ollama}
        form={form}
        apiKeyField="providers.ollamaBaseUrl" // unused by listOllamaModels, but ModelPicker's disabled-until-truthy check needs *some* field; ollamaBaseUrl serves the same "is this configured yet" role an API key does elsewhere
        baseUrlField="providers.ollamaBaseUrl"
      />
    </>
  )
}
```

- [ ] **Step 2: Add `providers.ollama.*` to `settings.json`**

Find (the `providers.azure` block Task 3 added, closing the file):

```
    "azure": {
      "endpoint": {
        "label": "Endpoint",
        "description": "Your Azure OpenAI resource endpoint URL"
      },
      "apiVersion": {
        "label": "API Version",
        "description": "Azure OpenAI API version string"
      },
      "model": {
        "label": "Model",
        "description": "The Azure deployment name to use"
      }
    }
  }
}
```

Replace with:

```
    "azure": {
      "endpoint": {
        "label": "Endpoint",
        "description": "Your Azure OpenAI resource endpoint URL"
      },
      "apiVersion": {
        "label": "API Version",
        "description": "Azure OpenAI API version string"
      },
      "model": {
        "label": "Model",
        "description": "The Azure deployment name to use"
      }
    },
    "ollama": {
      "baseUrl": {
        "label": "Base URL",
        "description": "Ollama server address for local model inference"
      },
      "status": {
        "label": "Status",
        "description": "Connection status of the Ollama server",
        "running": "Ollama is running",
        "notRunning": "Not running"
      }
    }
  }
}
```

- [ ] **Step 3: Add a test**

Find (the end of the `'has the Azure-specific provider field keys'` test body):

```
    expect(settings.providers.azure.model).toMatchObject({
      label: 'Model',
      description: 'The Azure deployment name to use'
    })
  })
})
```

Replace with:

```
    expect(settings.providers.azure.model).toMatchObject({
      label: 'Model',
      description: 'The Azure deployment name to use'
    })
  })

  it('has the Ollama-specific provider field keys', () => {
    expect(settings.providers.ollama.baseUrl).toMatchObject({
      label: 'Base URL',
      description: 'Ollama server address for local model inference'
    })
    expect(settings.providers.ollama.status).toMatchObject({
      label: 'Status',
      description: 'Connection status of the Ollama server',
      running: 'Ollama is running',
      notRunning: 'Not running'
    })
  })
})
```

- [ ] **Step 4: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/settings-form/providers/ollama.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the Ollama provider form"
```

---

## Task 5: `ModelPicker` — translation + the orphan test-id drive-by fix

**Files:**

- Modify: `src/renderer/components/settings/settings-form/providers/model-picker.tsx` (full rewrite — clean file)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `providers.model.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (add a test block)
- Modify: `CLAUDE.md` (remove the now-resolved orphan-id `--no-verify` exception)

**Interfaces:** Independent of Tasks 1-4's catalog additions (own
`providers.model.*` block). Consumed by all 6 provider tabs, unchanged
call signature — this task only changes what's rendered inside, not the
`ModelPickerProps` interface.

**Before starting:** confirm the orphan-id gap is still exactly as
described — `grep -rn "modelSelect" src tests` should show the id
declared in `test-ids.ts`, referenced by `tests/e2e/settings-model-
picker.spec.ts`, and applied nowhere in `src/renderer`. If someone else
already fixed this in the meantime, skip the `data-testid` addition in
Step 1 below and just do the translation work — but still verify Step 4's
CLAUDE.md edit is accurate to whatever the current state actually is
before applying it.

- [ ] **Step 1: Rewrite `model-picker.tsx`**

```tsx
import { TEST_IDS } from '@shared/constants/test-ids'
import {
  CachedModelEntry,
  SettingsInput,
  UseFormReturnType
} from '@shared/schemas/settings-schema'
import { AiProviders } from '@shared/types/ai'
import { fetcher, getHttpErrorMessage, toErrorI18n } from '@shared/utils/http'
import { AstroidIcon } from 'lucide-react'
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

import { SettingsRow, SettingsSection } from '../../settings-row'

interface ModelOption {
  value: string
  label: string
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
  const fetched =
    (form.watch(modelCatalogField) as CachedModelEntry[] | null | undefined) ??
    null

  const activeProvider = form.watch('providerConfig.provider')
  const savedModel =
    activeProvider === provider
      ? (form.watch('providerConfig.model') as string | undefined)
      : undefined

  const options: ModelOption[] =
    fetched?.map((m) => ({ value: m.id, label: m.displayName })) ??
    (savedModel ? [{ value: savedModel, label: savedModel }] : [])

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
        '/api/settings/models',
        {
          method: 'POST',
          body: { provider, apiKey, baseUrl, apiVersion }
        }
      )
      form.setValue(modelCatalogField, result.models, { shouldDirty: true })
    } catch (error) {
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
                <AstroidIcon />
              </InputGroupAddon>
            </ComboboxInput>
            <ComboboxContent>
              <ComboboxEmpty>
                {t('settings:providers.model.noModelsFound')}
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
      </SettingsRow>
    </SettingsSection>
  )
}
```

Two structural notes on this rewrite versus the original:

- `staleWarning` moves from a plain function called twice per render (once
  for the truthiness check, once for the rendered text — the original
  source had `staleWarning(fetched, savedModel)` appear twice) to a single
  computed value used both places, avoiding the double string
  construction now that it also has to go through `t()`.
- `useTranslation(['errors', 'settings'])` keeps `errors` FIRST since
  `toErrorI18n(i18n)` reads `i18n` from this exact hook call and expects
  it to behave as it did under the original single-namespace
  `useTranslation('errors')` — only the destructured `t` needs the new
  `settings:`-prefixed lookups; `i18n` itself is namespace-agnostic
  either way, but keeping `errors` first matches this plan's global
  constraint and every prior array-form conversion in this codebase.

- [ ] **Step 2: Add `providers.model.*` to `settings.json`**

Find (the `providers.ollama` block Task 4 added, closing the file):

```
    "ollama": {
      "baseUrl": {
        "label": "Base URL",
        "description": "Ollama server address for local model inference"
      },
      "status": {
        "label": "Status",
        "description": "Connection status of the Ollama server",
        "running": "Ollama is running",
        "notRunning": "Not running"
      }
    }
  }
}
```

Replace with:

```
    "ollama": {
      "baseUrl": {
        "label": "Base URL",
        "description": "Ollama server address for local model inference"
      },
      "status": {
        "label": "Status",
        "description": "Connection status of the Ollama server",
        "running": "Ollama is running",
        "notRunning": "Not running"
      }
    },
    "model": {
      "label": "Model",
      "description": "The model used for this provider",
      "searchPlaceholder": "Search models…",
      "noModelsFound": "No models found.",
      "refreshHint": "Refresh to see all available models.",
      "staleWarning": "\"{{model}}\" is no longer offered by this provider — pick a current model.",
      "retrieving": "Retrieving…",
      "refreshing": "Refreshing…",
      "retrieve": "Retrieve model list",
      "refresh": "Refresh model list",
      "fetchErrorTitle": "Could not fetch model list",
      "fetchErrorFallback": "Failed to fetch model list"
    }
  }
}
```

- [ ] **Step 3: Add a test**

Find (the end of the `'has the Ollama-specific provider field keys'` test body):

```
    expect(settings.providers.ollama.status).toMatchObject({
      label: 'Status',
      description: 'Connection status of the Ollama server',
      running: 'Ollama is running',
      notRunning: 'Not running'
    })
  })
})
```

Replace with:

```
    expect(settings.providers.ollama.status).toMatchObject({
      label: 'Status',
      description: 'Connection status of the Ollama server',
      running: 'Ollama is running',
      notRunning: 'Not running'
    })
  })

  it('has the ModelPicker keys', () => {
    expect(settings.providers.model.label).toBe('Model')
    expect(settings.providers.model.description).toBe(
      'The model used for this provider'
    )
    expect(settings.providers.model.searchPlaceholder).toBe('Search models…')
    expect(settings.providers.model.noModelsFound).toBe('No models found.')
    expect(settings.providers.model.refreshHint).toBe(
      'Refresh to see all available models.'
    )
    expect(settings.providers.model.staleWarning).toBe(
      '"{{model}}" is no longer offered by this provider — pick a current model.'
    )
    expect(settings.providers.model.retrieving).toBe('Retrieving…')
    expect(settings.providers.model.refreshing).toBe('Refreshing…')
    expect(settings.providers.model.retrieve).toBe('Retrieve model list')
    expect(settings.providers.model.refresh).toBe('Refresh model list')
    expect(settings.providers.model.fetchErrorTitle).toBe(
      'Could not fetch model list'
    )
    expect(settings.providers.model.fetchErrorFallback).toBe(
      'Failed to fetch model list'
    )
  })
})
```

- [ ] **Step 4: Update CLAUDE.md — remove the now-resolved orphan-id exception**

Find (the pre-commit-gate bullet's parenthetical, in the "Project
Constraints (read first)" section):

```
- **Pre-commit gate.** Before committing, `pnpm format` → `pnpm lint` →
  `pnpm typecheck` → `pnpm i18n:check` → `pnpm test` must pass. _Enforced by
  the husky pre-commit hook._ Do not `--no-verify` except for two known,
  standing causes: (1) the flaky PGlite WASM teardown in
  `src/main/lib/ai/context-management/index.test.ts`; (2) a standing,
  already-committed orphan-id gap in `TEST_IDS.providerModels.modelSelect`
  (declared in `test-ids.ts`, never applied under `src/renderer` — verify
  the exact cause yourself each time via `test-ids.linkage.test.ts`'s
  failure output and `git status`/`grep` before invoking this exception;
  it is not a blanket license to bypass any test-id failure).
```

Replace with:

```
- **Pre-commit gate.** Before committing, `pnpm format` → `pnpm lint` →
  `pnpm typecheck` → `pnpm i18n:check` → `pnpm test` must pass. _Enforced by
  the husky pre-commit hook._ Do not `--no-verify` except for one known,
  standing cause: the flaky PGlite WASM teardown in
  `src/main/lib/ai/context-management/index.test.ts`. (A second, long-
  standing exception — an orphan `TEST_IDS.providerModels.modelSelect` id
  — was resolved 2026-09-18 when `model-picker.tsx`'s i18n pass applied
  the id to its `ComboboxInput`, satisfying the linkage test the
  Playwright spec had been waiting on since before this id existed.)
```

- [ ] **Step 5: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace test-ids.linkage
```

`test-ids.linkage` should now show ZERO orphan ids — if it still reports
`TEST_IDS.providerModels.modelSelect` as orphaned, the `data-testid`
addition in Step 1 didn't land where the linkage checker's source scan
expects; re-check `grep -rn "TEST_IDS.providerModels.modelSelect"
src/renderer` finds the new usage before proceeding.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/settings/settings-form/providers/model-picker.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts \
  CLAUDE.md
git commit -m "feat(i18n): translate ModelPicker and close the orphan providerModels.modelSelect id"
```

---

## Task 6: Final verification, isolated committed-tree check, plan doc commit, push

**Files:** none new — verification and the plan document commit.

- [ ] **Step 1: Commit the plan document itself**

```bash
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-settings-providers.md
git commit -m "docs(i18n): Phase 2 settings-providers implementation plan"
```

- [ ] **Step 2: Full gate on the live workspace**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test
```

Expected: all pass, including `test-ids.linkage.test.ts` — this is the
first time in this whole i18n effort `pnpm test` should be fully green
with no `--no-verify` needed at all, now that Task 5 closed the orphan-id
gap. If it still fails for any reason, diagnose it properly rather than
assuming the old exception still applies (it no longer should).

- [ ] **Step 3: Isolated committed-tree check**

```bash
rm -rf /tmp/settings-providers-verify
mkdir -p /tmp/settings-providers-verify
git archive HEAD | tar -x -C /tmp/settings-providers-verify
ln -s "$(pwd)/node_modules" /tmp/settings-providers-verify/node_modules
cd /tmp/settings-providers-verify
./node_modules/.bin/tsc --noEmit -p tsconfig.web.json --composite false
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json --composite false
cd -
rm -rf /tmp/settings-providers-verify
```

Expected: both exit 0.

- [ ] **Step 4: Dispatch final review**

Dispatch a final whole-branch code review on the most capable available
model, covering every commit this plan produced. Point it at:

- This plan document, as the spec of record.
- The same failure classes that have bitten prior i18n sub-plans: wrong
  `ns:key` separator or missing prefix (`model-picker.tsx`'s array-form
  conversion is the one place this plan could get it wrong — confirm
  `errors` stayed first and every new lookup is `settings:`-prefixed),
  catalog/key desync across the FINAL merged `settings.json` and all 9
  files this plan touches, and confirm each commit's diff stat matches
  its task's file list exactly.
- Confirm the drive-by orphan-id fix is real and complete: the
  `data-testid` lands on an element the existing Playwright spec's
  `getByTestId(...).toBeVisible()` assertion can actually find, and
  CLAUDE.md's edit accurately describes the resolved state (only one
  standing `--no-verify` cause remains, not two).
- Confirm no `AiProviders` enum value or `providers-tabs.tsx` tab label
  was accidentally routed through `t()` — they must all stay hardcoded
  proper nouns, and confirm no API-key-format/URL/version placeholder
  value was translated either.

- [ ] **Step 5: Address findings, one fix wave**

If the final review finds issues: one fix dispatch addressing all of
them, then one scoped re-review of just the fix diff. Adjudicate any
residual disagreement yourself and record the ruling.

- [ ] **Step 6: Push**

Once final review is clean, push directly to `origin/dev`.

```bash
git push origin dev
```

- [ ] **Step 7: Update memory**

Update the `i18n-rollout-progress` memory file: mark `settings-providers`
complete with its commit range, note the "shared interpolated-template
key for near-identical per-provider fields, with the untranslated proper
noun passed as a param" pattern, and record that the orphan
`TEST_IDS.providerModels.modelSelect` gap — cited as a standing
`--no-verify` justification throughout this entire i18n effort — is now
closed; future sub-plans only have the one PGlite-teardown exception to
cite.
