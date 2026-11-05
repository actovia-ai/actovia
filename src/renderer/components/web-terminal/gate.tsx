import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  WEB_SESSION_EVENT,
  type WebTerminalStatus
} from '@actovia/shared/types/web-terminal'
import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn
} from '@simplewebauthn/browser'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { OdyMark } from '@/components/app/ody-mark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { queryClient } from '@/lib/query-client'
import {
  forgetWebTerminal,
  getWebTerminalStatus,
  webTerminalRequest
} from '@/services/web-terminal'

export function WebTerminalGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<WebTerminalStatus | null>(null)
  const previous = useRef(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  const supported = window.isSecureContext && browserSupportsWebAuthn()

  const refresh = useCallback(async () => {
    try {
      const next = await getWebTerminalStatus()
      if (previous.current && !next.unlocked) queryClient.clear()
      previous.current = next.unlocked
      setStatus(next)
      setError('')
    } catch {
      if (previous.current) queryClient.clear()
      previous.current = false
      setStatus((value) => (value ? { ...value, unlocked: false } : null))
      setError(t('webAccess.connectionFailed'))
    } finally {
      setChecking(false)
    }
  }, [t])

  useEffect(() => {
    void refresh()
    const changed = () => {
      void refresh()
    }
    const timer = setInterval(changed, 15_000)
    window.addEventListener(WEB_SESSION_EVENT, changed)
    window.addEventListener('focus', changed)
    return () => {
      clearInterval(timer)
      window.removeEventListener(WEB_SESSION_EVENT, changed)
      window.removeEventListener('focus', changed)
    }
  }, [refresh])

  useEffect(() => {
    if (!status?.unlocked) return
    let last = 0
    const activity = () => {
      if (Date.now() - last < 5000) return
      last = Date.now()
      void webTerminalRequest('/activity', {}).catch(() => refresh())
    }
    window.addEventListener('pointerdown', activity)
    window.addEventListener('keydown', activity)
    return () => {
      window.removeEventListener('pointerdown', activity)
      window.removeEventListener('keydown', activity)
    }
  }, [status?.unlocked, refresh])

  const connect = async () => {
    setBusy(true)
    setError('')
    try {
      if (status?.paired) {
        const request = await webTerminalRequest<{
          requestId: string
          options: Parameters<typeof startAuthentication>[0]['optionsJSON']
        }>('/unlock/options', {})
        const response = await startAuthentication({
          optionsJSON: request.options
        })
        await webTerminalRequest('/unlock/verify', {
          requestId: request.requestId,
          response
        })
      } else {
        const request = await webTerminalRequest<{
          requestId: string
          options: Parameters<typeof startRegistration>[0]['optionsJSON']
        }>('/pair/options', { code: code.trim(), name: name.trim() })
        const response = await startRegistration({
          optionsJSON: request.options
        })
        await webTerminalRequest('/pair/verify', {
          requestId: request.requestId,
          response
        })
      }
      setCode('')
      await refresh()
    } catch (cause) {
      setError(
        t(
          cause instanceof Error && cause.name === 'NotAllowedError'
            ? 'webAccess.cancelled'
            : 'webAccess.connectionFailed'
        )
      )
    } finally {
      setBusy(false)
    }
  }

  if (status?.unlocked) return children
  return (
    <main
      className="bg-background text-foreground flex min-h-svh items-center justify-center p-6"
      data-testid={TEST_IDS.webTerminal.gate}
    >
      <div className="w-full max-w-sm">
        <OdyMark className="mb-6 size-10" />
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('webAccess.connectTitle')}
        </h1>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          {t(
            status?.paired
              ? 'webAccess.pairedHint'
              : 'webAccess.connectDescription',
            { name: status?.deviceName }
          )}
        </p>
        {!supported ? (
          <p className="text-muted-foreground mt-6 text-sm" role="status">
            {t('webAccess.unsupported')}
          </p>
        ) : !status && checking ? (
          <p className="text-muted-foreground mt-6 text-sm" role="status">
            {t('webAccess.verifying')}
          </p>
        ) : !status ? (
          <Button
            className="mt-6"
            type="button"
            data-testid={TEST_IDS.webTerminal.retry}
            onClick={() => void refresh()}
          >
            {t('webAccess.retry')}
          </Button>
        ) : (
          <form
            className="mt-8 flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              void connect()
            }}
          >
            {!status.paired && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="terminal-name">
                    {t('webAccess.nameLabel')}
                  </Label>
                  <Input
                    id="terminal-name"
                    data-testid={TEST_IDS.webTerminal.name}
                    value={name}
                    maxLength={64}
                    required
                    autoComplete="off"
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="terminal-code">
                    {t('webAccess.codeLabel')}
                  </Label>
                  <Input
                    id="terminal-code"
                    data-testid={TEST_IDS.webTerminal.code}
                    value={code}
                    maxLength={128}
                    required
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </div>
              </>
            )}
            <Button
              type="submit"
              data-testid={TEST_IDS.webTerminal.connect}
              disabled={
                busy || (!status.paired && (!name.trim() || !code.trim()))
              }
            >
              {busy
                ? t('webAccess.verifying')
                : t(
                    status.paired ? 'webAccess.unlock' : 'webAccess.pairBrowser'
                  )}
            </Button>
            {status.paired && (
              <Button
                variant="ghost"
                type="button"
                disabled={busy}
                data-testid={TEST_IDS.webTerminal.forget}
                onClick={() =>
                  void forgetWebTerminal()
                    .then(refresh)
                    .catch(() => setError(t('webAccess.connectionFailed')))
                }
              >
                {t('webAccess.forget')}
              </Button>
            )}
          </form>
        )}
        {error && (
          <p className="text-destructive mt-4 text-sm" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  )
}
