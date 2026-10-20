import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { PinInput } from '@/components/lock/pin-input'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useLock } from '@/hooks/use-lock'
import { disableLock, setLockConfig, setLockPin } from '@/lib/lock-ipc'

import { SettingsRow, SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'

function PinBlock({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  )
}

export function LockPrivacy() {
  const { t } = useTranslation(['common', 'lock'])
  const { status, refresh } = useLock()
  const [step, setStep] = useState<'enter' | 'confirm'>('enter')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [removing, setRemoving] = useState(false)
  const [removePinValue, setRemovePinValue] = useState('')

  const idleOptions = useMemo(
    () => [
      { label: t('lock:privacy.idleOptions.off'), value: 0 },
      { label: t('lock:privacy.idleOptions.oneMinute'), value: 60_000 },
      { label: t('lock:privacy.idleOptions.fiveMinutes'), value: 300_000 },
      { label: t('lock:privacy.idleOptions.fifteenMinutes'), value: 900_000 },
      { label: t('lock:privacy.idleOptions.thirtyMinutes'), value: 1800_000 }
    ],
    [t]
  )

  if (!status) return null

  const resetEnroll = () => {
    setStep('enter')
    setPin('')
    setConfirm('')
  }

  const handlePinChange = (value: string) => {
    setPin(value)
    if (value.length === 6) setStep('confirm')
  }

  const handleConfirmChange = async (value: string) => {
    setConfirm(value)
    if (value.length !== 6) return
    if (value !== pin) {
      sileo.error({ title: t('lock:privacy.toast.pinsDoNotMatch') })
      resetEnroll()
      return
    }
    const { ok } = await setLockPin(pin)
    if (!ok) {
      sileo.error({
        title: t('lock:privacy.toast.setPinFailed.title'),
        description: t('lock:privacy.toast.setPinFailed.description')
      })
      resetEnroll()
      return
    }
    resetEnroll()
    await refresh()
    sileo.success({ title: t('lock:privacy.toast.lockEnabled') })
  }

  const removePin = async () => {
    const ok = await disableLock(removePinValue)
    if (!ok) {
      sileo.error({ title: t('lock:incorrectPin') })
      setRemovePinValue('')
      return
    }
    setRemoving(false)
    setRemovePinValue('')
    await refresh()
    sileo.success({ title: t('lock:privacy.toast.lockRemoved') })
  }

  const update = async (patch: Parameters<typeof setLockConfig>[0]) => {
    await setLockConfig(patch)
    await refresh()
  }

  return (
    <SettingsSection title={t('lock:privacy.title')} plain>
      <p className="text-muted-foreground text-sm">
        {t('lock:privacy.thirdParty')}
      </p>
      {status.hasPin ? (
        <>
          <SettingsSection>
            {status.touchIdAvailable && (
              <SettingsRow label={t('lock:privacy.touchIdToggleLabel')}>
                <Switch
                  checked={status.config.touchIdEnabled}
                  onCheckedChange={(v) => update({ touchIdEnabled: v })}
                />
              </SettingsRow>
            )}

            <SettingsRow label={t('lock:privacy.autoLockIdle')}>
              <SettingsSelect
                testId={TEST_IDS.lock.idleSelect}
                value={String(status.config.idleTimeoutMs)}
                onValueChange={(v) => update({ idleTimeoutMs: Number(v) })}
                options={idleOptions.map((o) => ({
                  value: String(o.value),
                  label: o.label
                }))}
              />
            </SettingsRow>

            <SettingsRow label={t('lock:privacy.lockOnLaunch')}>
              <Switch
                checked={status.config.lockOnLaunch}
                onCheckedChange={(v) => update({ lockOnLaunch: v })}
              />
            </SettingsRow>

            <SettingsRow label={t('lock:privacy.lockOnSystemSleep')}>
              <Switch
                checked={status.config.lockOnSystemSleep}
                onCheckedChange={(v) => update({ lockOnSystemSleep: v })}
              />
            </SettingsRow>

            <SettingsRow
              label={t('lock:privacy.removeLock.label')}
              description={t('lock:privacy.removeLock.description')}
            >
              <Button
                variant="destructive"
                size="sm"
                data-testid={TEST_IDS.lock.removeButton}
                onClick={() => setRemoving(true)}
              >
                {t('lock:privacy.removeLock.button')}
              </Button>
            </SettingsRow>
          </SettingsSection>

          <AlertDialog
            open={removing}
            onOpenChange={(open) => {
              if (!open) {
                setRemoving(false)
                setRemovePinValue('')
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t('lock:privacy.removeLock.dialogTitle')}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t('lock:privacy.removeLock.dialogDescription')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex justify-center py-1">
                <PinInput
                  value={removePinValue}
                  onChange={setRemovePinValue}
                  autoFocus
                  testId={TEST_IDS.lock.removePinInput}
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={removePinValue.length !== 6}
                  onClick={removePin}
                >
                  {t('lock:privacy.removeLock.confirmButton')}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : (
        <Card className="gap-4 px-5.5 py-5">
          <p className="text-muted-foreground text-sm">
            {t('lock:privacy.enroll.description')}
          </p>
          {step === 'enter' ? (
            <PinBlock label={t('lock:privacy.enroll.enterLabel')}>
              <PinInput
                key="enter"
                value={pin}
                onChange={handlePinChange}
                autoFocus
                testId={TEST_IDS.lock.enablePinInput}
              />
            </PinBlock>
          ) : (
            <PinBlock label={t('lock:privacy.enroll.confirmLabel')}>
              <PinInput
                key="confirm"
                value={confirm}
                onChange={handleConfirmChange}
                autoFocus
                testId={TEST_IDS.lock.confirmPinInput}
              />
              <Button
                variant="link"
                size="xs"
                onClick={resetEnroll}
                className="text-muted-foreground h-auto self-start p-0"
              >
                {t('lock:privacy.enroll.startOver')}
              </Button>
            </PinBlock>
          )}
        </Card>
      )}
    </SettingsSection>
  )
}
