import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { Key01Icon, ShieldAlertIcon } from '@hugeicons/core-free-icons'
import type { ParseKeys, TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { useSecretsStatus } from '@/hooks/use-secrets-status'

import { ENTER_UP, SettingsNotice } from '../settings-kit'

/** A settings secret's path → what the notice calls it. */
const FIELD_NAMES: Record<string, ParseKeys<'settings'>> = {
  'providers.openaiApiKey': 'secrets.fields.openaiApiKey',
  'providers.azureOpenaiApiKey': 'secrets.fields.azureOpenaiApiKey',
  'providers.anthropicApiKey': 'secrets.fields.anthropicApiKey',
  'providers.googleGeminiApiKey': 'secrets.fields.googleGeminiApiKey',
  'providers.xAiApiKey': 'secrets.fields.xAiApiKey',
  'googleCloud.googleApiKey': 'secrets.fields.googleApiKey',
  'webSearch.braveApiKey': 'secrets.fields.braveApiKey',
  'knowledgeBase.apiKey': 'secrets.fields.knowledgeBaseApiKey',
  's3.accessKeyId': 'secrets.fields.s3AccessKeyId',
  's3.secretAccessKey': 'secrets.fields.s3SecretAccessKey'
}

// `mcp:<server>:<column>.<name>` (or `url` / `args`); a server name may hold
// a colon, a column never does.
const MCP_LABEL = /^mcp:(.+):((?:env|headers|extraConfig)\..+|url|args)$/u

function secretName(t: TFunction<'settings'>, path: string): string {
  const mcp = MCP_LABEL.exec(path)
  if (mcp) return t('secrets.fields.mcp', { server: mcp[1], field: mcp[2] })
  const key = FIELD_NAMES[path]
  return key ? t(key) : path
}

/**
 * Settings → General, at the top: what `GET /api/v1/settings/secrets-status`
 * reports. Keys stored without encryption (no system keychain), and keys that
 * no longer decrypt (a changed signing identity, a denied keychain prompt) —
 * those read as unset, and each is named so the user knows what to re-enter.
 */
export function SecretsNotices() {
  const { t } = useTranslation('settings')
  const { data } = useSecretsStatus()
  if (!data) return null

  return (
    <>
      {data.encryption === 'unavailable' && (
        <div data-testid={TEST_IDS.secrets.encryptionNotice}>
          <SettingsNotice icon={ShieldAlertIcon} className={ENTER_UP}>
            {t('secrets.notice.encryptionUnavailable')}
          </SettingsNotice>
        </div>
      )}
      {data.needsReentry.length > 0 && (
        <div data-testid={TEST_IDS.secrets.reentryNotice}>
          <SettingsNotice icon={Key01Icon} className={ENTER_UP}>
            <p>{t('secrets.notice.needsReentry')}</p>
            <ul className="mt-1 list-disc pl-4">
              {data.needsReentry.map((path) => (
                <li key={path}>{secretName(t, path)}</li>
              ))}
            </ul>
          </SettingsNotice>
        </div>
      )}
    </>
  )
}
