import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import {
  cancelWebPairing,
  getWebAccess,
  pairWebBrowser,
  saveWebAccess
} from '@/services/web-access'
import {
  forgetWebTerminal,
  getWebTerminalStatus,
  lockWebTerminal
} from '@/services/web-terminal'

import { SettingsIntro } from '../settings-kit'
import { SettingsRow, SettingsSection } from '../settings-row'

export const webAccessKeys = ['web-access'] as const

export function WebAccessSettings() {
  const { t } = useTranslation('settings')
  const client = useQueryClient()
  const { data } = useQuery({
    queryKey: webAccessKeys,
    queryFn: getWebAccess,
    refetchInterval: (query) => (query.state.data?.pairing ? 1500 : false),
    refetchIntervalInBackground: true
  })
  const [origin, setOrigin] = useState('')
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    if (data) {
      setOrigin(data.origin)
      setEnabled(data.enabled)
    }
  }, [data?.origin, data?.enabled])
  useEffect(() => {
    if (data?.pairing === null)
      void client.invalidateQueries({ queryKey: ['devices'] })
  }, [data?.pairing, client])
  const change = useMutation({
    mutationFn: async (action: 'save' | 'pair' | 'cancel') =>
      action === 'save'
        ? saveWebAccess({ enabled, origin })
        : action === 'pair'
          ? pairWebBrowser()
          : cancelWebPairing(),
    onSuccess: (value) => client.setQueryData(webAccessKeys, value),
    onSettled: () => client.invalidateQueries({ queryKey: ['devices'] }),
    meta: { errorTitle: t('webAccess.saveFailed') }
  })
  const proxyCommand = `tailscale serve --bg http://127.0.0.1:${data?.port ?? 63130}`
  const changed = !!data && (enabled !== data.enabled || origin !== data.origin)
  return (
    <SettingsSection title={t('webAccess.heading')}>
      <SettingsRow
        label={t('webAccess.enabledLabel')}
        description={t('webAccess.description')}
      >
        <Switch
          data-testid={TEST_IDS.webAccess.enabled}
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label={t('webAccess.enabledLabel')}
          disabled={!data || change.isPending}
        />
      </SettingsRow>
      <SettingsRow
        label={t('webAccess.originLabel')}
        description={t('webAccess.originHint')}
        layout="vertical"
      >
        <div className="flex flex-wrap gap-2">
          <Input
            type="url"
            data-testid={TEST_IDS.webAccess.origin}
            aria-label={t('webAccess.originLabel')}
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
            placeholder="https://your-mac.example.ts.net"
            className="min-w-0 flex-1 basis-64"
            disabled={!data || change.isPending}
          />
          <Button
            type="button"
            data-testid={TEST_IDS.webAccess.save}
            disabled={
              !changed || change.isPending || (enabled && !origin.trim())
            }
            onClick={() => change.mutate('save')}
          >
            {t('webAccess.save')}
          </Button>
        </div>
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
          {t('webAccess.proxyHint', { port: data?.port ?? 63130 })}
        </p>
        <code className="bg-muted mt-2 block overflow-x-auto rounded-md p-3 text-xs">
          {proxyCommand}
        </code>
      </SettingsRow>
      <SettingsRow
        label={t('webAccess.pairBrowser')}
        description={t('webAccess.pairHint')}
        layout="vertical"
      >
        {data?.pairing ? (
          <div className="flex flex-col items-start gap-3">
            <p
              className="font-mono text-lg tracking-wide select-all"
              data-testid={TEST_IDS.webAccess.pairingCode}
            >
              {data.pairing.code}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('webAccess.expiresHint')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid={TEST_IDS.webAccess.copyCode}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(data.pairing!.code)
                    .catch(() =>
                      toast.add({
                        type: 'error',
                        title: t('webAccess.copyFailed')
                      })
                    )
                }
              >
                {t('webAccess.copyCode')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid={TEST_IDS.webAccess.cancelPairing}
                disabled={change.isPending}
                onClick={() => change.mutate('cancel')}
              >
                {t('webAccess.cancelPairing')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            data-testid={TEST_IDS.webAccess.pair}
            disabled={!data?.running || changed || change.isPending}
            onClick={() => change.mutate('pair')}
          >
            {t('webAccess.pairBrowser')}
          </Button>
        )}
      </SettingsRow>
    </SettingsSection>
  )
}

export function BrowserDeviceSettings() {
  const { t } = useTranslation('settings')
  const action = useMutation({
    mutationFn: (kind: 'lock' | 'forget') =>
      kind === 'lock' ? lockWebTerminal() : forgetWebTerminal(),
    meta: { errorTitle: t('webAccess.connectionFailed') }
  })
  const { data } = useQuery({
    queryKey: ['web-terminal'],
    queryFn: getWebTerminalStatus
  })
  return (
    <>
      <SettingsIntro>{t('webAccess.remoteTerminal')}</SettingsIntro>
      <SettingsSection title={data?.deviceName}>
        <SettingsRow
          label={t('webAccess.lock')}
          description={t('webAccess.lockHint')}
        >
          <Button
            type="button"
            variant="outline"
            data-testid={TEST_IDS.webTerminal.lock}
            disabled={action.isPending}
            onClick={() => action.mutate('lock')}
          >
            {t('webAccess.lock')}
          </Button>
        </SettingsRow>
        <SettingsRow
          label={t('webAccess.forget')}
          description={t('webAccess.forgetHint')}
        >
          <Button
            type="button"
            variant="destructive"
            disabled={action.isPending}
            onClick={() => action.mutate('forget')}
          >
            {t('webAccess.forget')}
          </Button>
        </SettingsRow>
      </SettingsSection>
    </>
  )
}
