import { UseFormReturnType } from '@exodus/shared/schemas/settings-schema'
import { Controller } from 'react-hook-form'
import { Trans, useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'

import { SecretInput } from '../secret-fields'
import { SettingsIntro } from '../settings-kit'
import { SettingsRow, SettingsSection } from '../settings-row'

// Each of these is its own named component (rather than JSX inlined
// directly into `S3`) specifically so `tests/unit/i18n/settings-namespace.test.ts`
// can import and render the REAL component — a formatter-driven reflow of
// this file (oxfmt inserts/removes `{' '}` around wrapped JSX text, which
// shifts `<Trans>`'s positional numbering for non-allowlisted tags like
// `<code>`/`<em>`) must be caught by rendering the actual source, not a
// hand-copied children array that can silently drift out of sync with it.

export function EncodingNotice() {
  return (
    <Trans ns="settings" i18nKey="tools.s3.alert.encoding">
      By default, Actovia encodes attachments as <strong>base64</strong> inline
      in the prompt. For large files or vision-heavy workflows, uploading to S3
      and passing a URL is more efficient and reliable.
    </Trans>
  )
}

export function RequirementsHeading() {
  return (
    <Trans ns="settings" i18nKey="tools.s3.alert.requirementsHeading">
      <strong>Requirements before configuring:</strong>
    </Trans>
  )
}

export function PublicReadAccessNotice() {
  return (
    <Trans ns="settings" i18nKey="tools.s3.alert.publicReadAccess">
      <strong>Public read access</strong> — AWS blocks public access by default.
      You must disable "Block all public access" on the bucket and attach a
      bucket policy granting <code>s3:GetObject</code> to <code>*</code>, so the
      AI provider can fetch the URL without credentials.
    </Trans>
  )
}

export function CorsNotice() {
  return (
    <Trans ns="settings" i18nKey="tools.s3.alert.cors">
      <strong>CORS</strong> — Add a CORS rule allowing <code>PUT</code> from{' '}
      <code>*</code> (or your app origin) so Actovia can upload directly from
      the desktop.
    </Trans>
  )
}

export function IamCredentialsNotice() {
  return (
    <Trans ns="settings" i18nKey="tools.s3.alert.iamCredentials">
      <strong>IAM credentials</strong> — The Access Key ID / Secret Access Key
      must belong to an IAM user or role with at least <code>s3:PutObject</code>{' '}
      and <code>s3:PutObjectAcl</code> permissions on the configured bucket.
    </Trans>
  )
}

export function ObjectAclNotice() {
  return (
    <Trans ns="settings" i18nKey="tools.s3.alert.objectAcl">
      <strong>Object ACL</strong> — Each uploaded object is set to{' '}
      <code>public-read</code>. Your bucket must not have ACLs disabled (i.e.,
      Object Ownership must be set to{' '}
      <em>ACLs enabled / Bucket owner preferred</em>).
    </Trans>
  )
}

export function S3({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <>
      <SettingsIntro>
        <p>
          <EncodingNotice />
        </p>
        <p>
          <RequirementsHeading />
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-4">
          <li>
            <PublicReadAccessNotice />
          </li>
          <li>
            <CorsNotice />
          </li>
          <li>
            <IamCredentialsNotice />
          </li>
          <li>
            <ObjectAclNotice />
          </li>
        </ul>
      </SettingsIntro>
      <SettingsSection>
        <Controller
          control={form.control}
          name="s3.region"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.s3.region.label')}
              description={t('tools.s3.region.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <Input
                type="input"
                id="s3-region-input"
                placeholder="ap-northeast-1"
                {...field}
                value={field.value ?? ''}
              />
            </SettingsRow>
          )}
        />
        <Controller
          control={form.control}
          name="s3.bucket"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.s3.bucket.label')}
              description={t('tools.s3.bucket.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <Input
                type="input"
                id="s3-bucket-input"
                placeholder={t('tools.s3.bucket.placeholder')}
                {...field}
                value={field.value ?? ''}
              />
            </SettingsRow>
          )}
        />
        <Controller
          control={form.control}
          name="s3.accessKeyId"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.s3.accessKeyId.label')}
              description={t('tools.s3.accessKeyId.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <SecretInput
                id="s3-accessKeyId-input"
                {...field}
                value={field.value}
              />
            </SettingsRow>
          )}
        />
        <Controller
          control={form.control}
          name="s3.secretAccessKey"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.s3.secretAccessKey.label')}
              description={t('tools.s3.secretAccessKey.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <SecretInput
                id="s3-secretAccessKey-input"
                {...field}
                value={field.value}
              />
            </SettingsRow>
          )}
        />
      </SettingsSection>
    </>
  )
}
