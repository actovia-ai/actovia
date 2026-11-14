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

import pairingWelcome from '@/assets/images/pairing-welcome-desktop.jpg'
import { OdyMark } from '@/components/app/ody-mark'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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
      className="bg-muted text-foreground flex min-h-svh flex-col items-center justify-center p-6 md:p-10"
      data-testid={TEST_IDS.webTerminal.gate}
      data-tone-scope="neutral"
    >
      <div className="w-full max-w-sm md:max-w-4xl">
        <Card className="p-0">
          <CardContent className="grid p-0 md:grid-cols-2">
            <section className="flex min-w-0 flex-col justify-center p-6 md:min-h-128 md:p-8">
              <div className="mb-8 flex flex-col items-center gap-3 text-center">
                <OdyMark className="size-10" />
                <h1 className="text-2xl font-semibold tracking-tight text-balance">
                  {t('webAccess.connectTitle')}
                </h1>
                <p className="text-muted-foreground text-sm leading-relaxed text-pretty wrap-anywhere">
                  {t(
                    status?.paired
                      ? 'webAccess.pairedHint'
                      : 'webAccess.connectDescription',
                    { name: status?.deviceName }
                  )}
                </p>
              </div>
              {supported ? (
                !status && checking ? (
                  <p className="text-muted-foreground text-sm" role="status">
                    {t('webAccess.verifying')}
                  </p>
                ) : !status ? (
                  <Button
                    className="w-full"
                    type="button"
                    data-testid={TEST_IDS.webTerminal.retry}
                    onClick={() => void refresh()}
                  >
                    {t('webAccess.retry')}
                  </Button>
                ) : (
                  <form
                    className="flex flex-col gap-5"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void connect()
                    }}
                  >
                    <FieldGroup>
                      {!status.paired && (
                        <>
                          <Field>
                            <FieldLabel htmlFor="terminal-name">
                              {t('webAccess.nameLabel')}
                            </FieldLabel>
                            <Input
                              id="terminal-name"
                              data-testid={TEST_IDS.webTerminal.name}
                              value={name}
                              maxLength={64}
                              required
                              autoComplete="off"
                              onChange={(event) => setName(event.target.value)}
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="terminal-code">
                              {t('webAccess.codeLabel')}
                            </FieldLabel>
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
                          </Field>
                        </>
                      )}
                      <Button
                        type="submit"
                        data-testid={TEST_IDS.webTerminal.connect}
                        disabled={
                          busy ||
                          (!status.paired && (!name.trim() || !code.trim()))
                        }
                      >
                        {busy
                          ? t('webAccess.verifying')
                          : t(
                              status.paired
                                ? 'webAccess.unlock'
                                : 'webAccess.pairBrowser'
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
                              .catch(() =>
                                setError(t('webAccess.connectionFailed'))
                              )
                          }
                        >
                          {t('webAccess.forget')}
                        </Button>
                      )}
                    </FieldGroup>
                  </form>
                )
              ) : (
                <p className="text-muted-foreground text-sm" role="status">
                  {t('webAccess.unsupported')}
                </p>
              )}
              {error && (
                <p className="text-destructive mt-4 text-sm" role="alert">
                  {error}
                </p>
              )}
            </section>
            <div
              className="bg-muted/60 relative hidden items-center justify-center overflow-hidden md:flex"
              aria-hidden="true"
            >
              <img
                src={pairingWelcome}
                alt=""
                draggable={false}
                className="h-full max-h-160 w-full object-cover select-none"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
