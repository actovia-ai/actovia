import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { LockNotification, LockStatus } from '@actovia/shared/types/lock'
import { FingerPrintIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  getRecentLockNotifications,
  onLockNotification,
  unlockWithPin,
  unlockWithTouchId
} from '@/lib/lock-ipc'

import { PinInput } from './pin-input'

const PIN_LENGTH = 6

export function LockScreen({
  status,
  onUnlocked
}: {
  status: LockStatus
  onUnlocked: () => void
}) {
  const { t } = useTranslation('lock')
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)
  const [error, setError] = useState('')
  const [feed, setFeed] = useState<LockNotification[]>([])
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    getRecentLockNotifications().then(setFeed)
    return onLockNotification((n) =>
      setFeed((prev) => [n, ...prev].slice(0, 20))
    )
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const touchId = status.touchIdAvailable && status.config.touchIdEnabled

  useEffect(() => {
    if (pin.length !== PIN_LENGTH) return
    let cancelled = false
    unlockWithPin(pin).then((res) => {
      if (cancelled) return
      if (res.ok) {
        onUnlocked()
      } else {
        setShake(true)
        setError(
          res.reason === 'locked-out'
            ? t('screen.tooManyAttempts', {
                seconds: Math.ceil(res.retryAfterMs / 1000)
              })
            : t('incorrectPin')
        )
        setPin('')
        setTimeout(() => setShake(false), 450)
      }
    })
    return () => {
      cancelled = true
    }
  }, [pin, onUnlocked, t])

  const tryTouchId = async () => {
    const res = await unlockWithTouchId()
    if (res.ok) onUnlocked()
  }

  return (
    <div className="bg-background text-foreground fixed inset-0 z-[100] flex flex-col items-center justify-center gap-10">
      {/* Frameless-window drag strip: the window can be moved while locked. */}
      <div className="draggable absolute inset-x-0 top-0 h-16" />
      <div className="text-center">
        <div className="text-5xl font-extralight tabular-nums">
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div className="text-muted-foreground mt-1 text-sm">
          {now.toLocaleDateString([], {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
          })}
        </div>
      </div>

      <PinInput
        value={pin}
        onChange={setPin}
        autoFocus
        shake={shake}
        slotClassName="size-12 text-lg"
        testId={TEST_IDS.lock.pinInput}
      />

      <div className="text-destructive h-5 text-sm">{error}</div>

      {touchId && (
        <Button
          variant="ghost"
          size="sm"
          data-testid={TEST_IDS.lock.touchIdButton}
          onClick={tryTouchId}
          className="no-drag text-muted-foreground"
        >
          <HugeiconsIcon icon={FingerPrintIcon} size={18} />{' '}
          {t('screen.unlockWithTouchId')}
        </Button>
      )}

      {feed.length > 0 && (
        <div className="absolute bottom-8 w-full max-w-md px-6">
          <div className="flex flex-col gap-2">
            {feed.slice(0, 3).map((n) => (
              <div
                key={n.id}
                className="bg-card/80 border-border rounded-xl border px-4 py-3 backdrop-blur"
              >
                <div className="text-sm font-medium">{n.title}</div>
                <div className="text-muted-foreground line-clamp-2 text-xs">
                  {n.body}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
