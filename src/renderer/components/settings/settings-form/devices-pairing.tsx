import { PAIRING_TTL_MS } from '@actovia/shared/constants/systems'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  Tick02Icon,
  Copy01Icon,
  SmartPhone01Icon,
  Wifi01Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useClipboard } from '@/hooks/use-clipboard'
import { cn } from '@/lib/utils'
import type { PairingInfo } from '@/services/devices'

import {
  ENTER,
  ENTER_UP,
  SettingsItem,
  SettingsNotice,
  staggerDelay,
  StepBadge,
  SwapLabel
} from '../settings-kit'
import { SettingsSection } from '../settings-row'

/** Seconds until `expiresAt`, ticking once a second. */
function useSecondsLeft(expiresAt: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, Math.ceil((expiresAt - now) / 1000))
}

/** The second step names a menu path, which is the part people hunt for. */
export function PairingNavigateStep() {
  return (
    <Trans ns="settings" i18nKey="devices.pairing.steps.navigate">
      Go to <strong>Settings → Pair with computer</strong>
    </Trans>
  )
}

function CopyLinkButton({ link }: { link: string }) {
  const { t } = useTranslation('settings')
  const { copied, handleCopy } = useClipboard()
  const done = copied === link

  return (
    <Button
      type="button"
      variant="outline"
      data-testid={TEST_IDS.devices.copyLinkButton}
      onClick={() => handleCopy(link)}
    >
      <SwapLabel
        active={done ? 'done' : 'idle'}
        labels={{
          idle: (
            <>
              <HugeiconsIcon icon={Copy01Icon} />
              {t('devices.pairing.copyLink')}
            </>
          ),
          done: (
            <>
              <HugeiconsIcon icon={Tick02Icon} />
              {t('devices.pairing.linkCopied')}
            </>
          )
        }}
      />
    </Button>
  )
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const { t } = useTranslation('settings')
  const secondsLeft = useSecondsLeft(expiresAt)
  const time = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`

  return (
    <div className="flex w-full flex-col items-center gap-2">
      {/* Ticks once a second; a one-second linear transition between ticks
          makes the bar drain instead of step. The text says the same thing. */}
      <Progress
        aria-hidden
        value={secondsLeft}
        max={PAIRING_TTL_MS / 1000}
        className="w-full **:data-[slot=progress-indicator]:rounded-xl **:data-[slot=progress-indicator]:duration-1000 **:data-[slot=progress-indicator]:ease-linear **:data-[slot=progress-track]:h-1"
      />
      <p className="text-muted-foreground text-xs tabular-nums">
        {t('devices.pairing.expiresIn', { time })}
      </p>
    </div>
  )
}

export function PairingPanel({
  pairing,
  onCancel
}: {
  pairing: PairingInfo
  onCancel: () => void
}) {
  const { t } = useTranslation('settings')
  const steps = [
    { key: 'open', body: t('devices.pairing.steps.open') },
    { key: 'navigate', body: <PairingNavigateStep /> },
    { key: 'scan', body: t('devices.pairing.steps.scan') }
  ]

  return (
    <SettingsSection>
      <div className="@container">
        <div className="grid gap-x-10 gap-y-6 @xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex flex-col gap-5">
            <h3 className={cn('text-base font-semibold', ENTER_UP)}>
              {t('devices.pairing.title')}
            </h3>
            <ol className="flex flex-col gap-3.5">
              {steps.map((step, index) => (
                <li
                  key={step.key}
                  className={cn('flex items-start gap-3 text-sm', ENTER_UP)}
                  style={staggerDelay(index + 1)}
                >
                  <StepBadge>{index + 1}</StepBadge>
                  <span className="pt-0.5 [&_strong]:font-semibold">
                    {step.body}
                  </span>
                </li>
              ))}
            </ol>
            <SettingsNotice
              icon={Wifi01Icon}
              className={ENTER_UP}
              style={staggerDelay(steps.length + 1)}
            >
              {t('devices.pairing.sameNetwork')}
            </SettingsNotice>
          </div>

          <div className="flex flex-col items-center gap-3 justify-self-center @xl:row-span-2 @xl:self-center">
            {/* Always dark-on-light: a QR code inverted for dark mode won't scan. */}
            <Card
              className={cn(
                'rounded-xl bg-white p-3 starting:scale-[0.96]',
                ENTER
              )}
            >
              <QRCodeSVG
                value={pairing.link}
                size={208}
                marginSize={2}
                data-testid={TEST_IDS.devices.qrCode}
              />
            </Card>
            <Countdown expiresAt={pairing.expiresAt} />
          </div>

          <div className="flex gap-2 @xl:self-end">
            <CopyLinkButton link={pairing.link} />
            <Button
              type="button"
              variant="ghost"
              data-testid={TEST_IDS.devices.cancelPairingButton}
              onClick={onCancel}
            >
              {t('devices.pairing.cancel')}
            </Button>
          </div>
        </div>
      </div>
    </SettingsSection>
  )
}

export function PairCard({ onPair }: { onPair: () => void }) {
  const { t } = useTranslation('settings')

  return (
    <SettingsSection>
      <SettingsItem
        className={ENTER}
        icon={<HugeiconsIcon icon={SmartPhone01Icon} />}
        title={t('devices.pairCard.title')}
        description={t('devices.pairCard.description')}
        actions={
          <Button
            type="button"
            data-testid={TEST_IDS.devices.pairButton}
            onClick={onPair}
          >
            {t('devices.pair')}
          </Button>
        }
      />
    </SettingsSection>
  )
}
