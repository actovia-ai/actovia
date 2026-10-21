import { OTPInputContext, REGEXP_ONLY_DIGITS } from 'input-otp'
import { useContext } from 'react'

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator
} from '@/components/ui/input-otp'
import { cn } from '@/lib/utils'

const PIN_LENGTH = 6

/**
 * Masked OTP slot — renders a dot instead of the typed digit. Local to
 * pin-input so it survives regeneration of `components/ui/input-otp`.
 */
function MaskedSlot({
  index,
  className
}: {
  index: number
  className?: string
}) {
  const ctx = useContext(OTPInputContext)
  const { char, hasFakeCaret, isActive } = ctx?.slots[index] ?? {}

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      className={cn(
        // The active slot's ring is drawn inside it: an outer ring round a
        // slot whose neighbours share its edges read as a clipped square.
        'border-input bg-input/50 data-[active=true]:border-ring data-[active=true]:ring-ring/40 relative flex size-8 items-center justify-center border-y border-r text-sm transition-[color,box-shadow] duration-200 outline-none first:rounded-l-2xl first:border-l last:rounded-r-2xl data-[active=true]:z-10 data-[active=true]:ring-2 data-[active=true]:ring-inset',
        className
      )}
    >
      {char ? <span className="bg-foreground size-2.5 rounded-full" /> : null}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="animate-caret-blink bg-foreground h-4 w-px duration-1000" />
        </div>
      )}
    </div>
  )
}

/**
 * Shared 6-digit PIN entry rendered as two groups of three OTP slots split by a
 * separator. Used by the lock screen and the Lock & Privacy settings so both
 * share one look. Digit-only; calls `onChange` with the current value.
 */
export function PinInput({
  value,
  onChange,
  autoFocus,
  shake,
  slotClassName,
  testId
}: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  shake?: boolean
  slotClassName?: string
  testId?: string
}) {
  const slot = (index: number) => (
    <MaskedSlot index={index} className={slotClassName} />
  )

  return (
    <div className={cn('w-fit', shake && 'animate-shake')}>
      <InputOTP
        data-testid={testId}
        maxLength={PIN_LENGTH}
        value={value}
        onChange={onChange}
        pattern={REGEXP_ONLY_DIGITS}
        autoFocus={autoFocus}
        containerClassName="gap-3"
      >
        <InputOTPGroup>
          {slot(0)}
          {slot(1)}
          {slot(2)}
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          {slot(3)}
          {slot(4)}
          {slot(5)}
        </InputOTPGroup>
      </InputOTP>
    </div>
  )
}
