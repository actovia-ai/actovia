import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import { ShownDefault } from './shown-default'

/** Zero is the persisted unlimited value; an unset field still uses its normal default. */
export function LimitInput({
  value,
  fallback,
  max,
  onChange,
  onBlur,
  label,
  testId
}: {
  value: number | null | undefined
  fallback: number
  max: number
  onChange: (value: number | null) => void
  onBlur: () => void
  label: string
  testId?: string
}) {
  const { t } = useTranslation('common')
  return (
    <div className="flex items-center gap-3">
      {value !== 0 && (
        <ShownDefault value={value} fallback={fallback} onBlur={onBlur}>
          {(shown) => (
            <Input
              {...shown}
              type="number"
              min={1}
              max={max}
              step={1}
              className="w-20"
              aria-label={label}
              data-testid={testId}
              onChange={(event) =>
                onChange(
                  event.target.value === '' ? null : Number(event.target.value)
                )
              }
            />
          )}
        </ShownDefault>
      )}
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={value === 0}
          onCheckedChange={(unlimited) => onChange(unlimited ? 0 : fallback)}
          onBlur={onBlur}
          aria-label={`${label}: ${t('unlimited')}`}
        />
        {t('unlimited')}
      </label>
    </div>
  )
}
