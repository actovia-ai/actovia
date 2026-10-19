import { AiProviders } from '@exodus/shared/types/ai'

/**
 * Every secret Actovia stores (spec 2026-09-25 §2.2). A registry field leaves
 * the main process only as a mask (`mask.ts`); S2 encrypts exactly these at
 * rest. `tests/unit/main/lib/secrets/registry.test.ts` walks the settings
 * schema and fails on any field whose name matches `isSecretName` that
 * is in neither list below — a new key field needs a decision here.
 */

/** Dotted paths into the `settings` row (a section column, then its field). */
export const SETTINGS_SECRET_PATHS = [
  'providers.openaiApiKey',
  'providers.azureOpenaiApiKey',
  'providers.anthropicApiKey',
  'providers.googleGeminiApiKey',
  'providers.xAiApiKey',
  'googleCloud.googleApiKey',
  'webSearch.braveApiKey',
  'knowledgeBase.apiKey',
  // Also carried, by design, in the `X-Amz-Credential` of every presigned
  // URL `POST /api/v1/s3/presigned-url` returns (the secret key is not).
  's3.accessKeyId',
  's3.secretAccessKey'
] as const

export type SettingsSecretPath = (typeof SETTINGS_SECRET_PATHS)[number]

/**
 * Registry secrets the settings API still hands out in plaintext — each an
 * open gap with its reason, not a decision that the field is safe (it is still
 * encrypted at rest and stripped from exports).
 */
export const API_PLAINTEXT_EXCEPTIONS: Partial<
  Record<SettingsSecretPath, string>
> = {
  // Empty. `googleCloud.googleApiKey` was here until the final review of the
  // 2026-09-25 pass (I5): the map card now gets the Maps JS key over IPC
  // (`maps:js-key`, main frame only) and Places photos through
  // `GET /api/v1/maps/photo`, so the API masks it like every other key.
}

/** The registry fields `GET /api/v1/settings` answers with a mask. */
export const API_MASKED_SETTINGS_PATHS: readonly SettingsSecretPath[] =
  SETTINGS_SECRET_PATHS.filter((p) => !(p in API_PLAINTEXT_EXCEPTIONS))

/**
 * Fields whose name looks like a secret but are not one — each with why.
 * (Paths use `*` for a record's values and `[]` for an array's items, as
 * the coverage test walks them.)
 */
export const SETTINGS_NON_SECRET_PATHS: Record<string, string> = {
  // A model's output-token limit (a number), not an auth token.
  'providerConfig.modelSnapshot.maxOutputTokens': 'token budget, a number',
  'modelCatalog.*.[].snapshot.maxOutputTokens': 'token budget, a number'
}

export { isSecretName } from '@exodus/shared/utils/secret-detect'

/**
 * `mcp_server` columns whose every value is a secret: env vars handed to a
 * stdio server and headers sent to a remote one (tokens, `Authorization`).
 * `extraConfig` is free-form, so inside it a string whose key matches
 * `isSecretName` (an OAuth `clientSecret`, an `apiKey`) is a secret.
 */
export const MCP_SECRET_RECORD_COLUMNS = ['env', 'headers'] as const
export const MCP_KEY_NAMED_SECRET_COLUMNS = ['extraConfig'] as const

/** Which `providers.*` field holds each provider's API key. */
export const PROVIDER_KEY_FIELD: Record<
  Exclude<AiProviders, AiProviders.Ollama>,
  string
> = {
  [AiProviders.OpenAiGpt]: 'openaiApiKey',
  [AiProviders.AzureOpenAi]: 'azureOpenaiApiKey',
  [AiProviders.AnthropicClaude]: 'anthropicApiKey',
  [AiProviders.GoogleGemini]: 'googleGeminiApiKey',
  [AiProviders.XaiGrok]: 'xAiApiKey'
}

/**
 * Where each provider's key is sent: the `providers.*` base-URL field, and
 * the default the list-models handlers fall back to when it is unset. A stored
 * key is only ever substituted for a mask when the request's destination is
 * this one (`routes/settings.ts`, `POST /models`).
 */
export const PROVIDER_BASE_URL: Record<
  Exclude<AiProviders, AiProviders.Ollama>,
  { field: string; fallback: string | null }
> = {
  [AiProviders.OpenAiGpt]: {
    field: 'openaiBaseUrl',
    fallback: 'https://api.openai.com/v1'
  },
  [AiProviders.AzureOpenAi]: { field: 'azureOpenAiEndpoint', fallback: null },
  [AiProviders.AnthropicClaude]: {
    field: 'anthropicBaseUrl',
    fallback: 'https://api.anthropic.com'
  },
  [AiProviders.GoogleGemini]: {
    field: 'googleGeminiBaseUrl',
    fallback: 'https://generativelanguage.googleapis.com/v1beta'
  },
  [AiProviders.XaiGrok]: {
    field: 'xAiBaseUrl',
    fallback: 'https://api.x.ai/v1'
  }
}

/**
 * Where a secret is sent, as the dotted path of the field that holds the
 * destination (and its default when unset). A settings write that moves the
 * destination while the secret comes back as its mask clears the secret
 * (ledger ruling R1): a stored key is never carried to a new host — the user
 * enters it again for the new one. Compared with `normalizeBaseUrl`. Secrets
 * not listed go to a fixed service (Brave, Google, AWS by region).
 */
export const SECRET_DESTINATIONS: Partial<
  Record<SettingsSecretPath, { field: string; fallback: string | null }>
> = {
  ...Object.fromEntries(
    (
      Object.keys(PROVIDER_KEY_FIELD) as Array<keyof typeof PROVIDER_KEY_FIELD>
    ).map((p) => [
      `providers.${PROVIDER_KEY_FIELD[p]}`,
      {
        field: `providers.${PROVIDER_BASE_URL[p].field}`,
        fallback: PROVIDER_BASE_URL[p].fallback
      }
    ])
  ),
  'knowledgeBase.apiKey': { field: 'knowledgeBase.url', fallback: null }
}

/**
 * Inside `extraConfig`, a string under a key like this names a destination
 * too (an OAuth `issuer` / `tokenUrl` / `token_uri` / `jwks_uri`, an Azure AD
 * `authority`, an Auth0 `domain`, a proxy `host`, an `endpoint`): when one
 * changes, the `url`-bound secrets (`headers`, the `extraConfig` secrets) are
 * cleared as for a new `url` (ruling a).
 */
export const MCP_EXTRA_CONFIG_DESTINATION_KEY =
  /url|uri|endpoint|host|issuer|authority|domain/iu

/**
 * The same rule for an `mcp_server` row: `headers` and the secrets inside
 * `extraConfig` go to `url`; `env` goes to the process `command` starts.
 */
export const MCP_SECRET_DESTINATIONS = {
  headers: 'url',
  extraConfig: 'url',
  env: 'command'
} as const
