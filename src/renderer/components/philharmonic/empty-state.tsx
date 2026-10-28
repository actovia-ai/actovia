import { type ReactNode } from 'react'

import { Button } from '@/components/ui/button'

import type { HueName } from './lib/hue'

interface AvatarSpec {
  hue: HueName
  content?: ReactNode
}

interface Props {
  avatars: AvatarSpec[]
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

const SMALL = 48
const LARGE = 56

export function PhilharmonicEmptyState({
  avatars,
  title,
  description,
  action
}: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex">
        {avatars.map((a, i) => {
          const size = i === 1 ? LARGE : SMALL
          const isCenter = i === 1
          const offset = i === 0 ? 6 : i === 2 ? -6 : 0
          return (
            <div
              key={a.hue}
              className={i === 0 ? '' : '-ml-2'}
              style={{
                width: size,
                height: size,
                borderRadius: '50%',
                background: `var(--ph-hue-${a.hue}-fill)`,
                boxShadow: `inset 0 0 0 1.5px var(--ph-hue-${a.hue}-ring), 0 0 0 3px var(--card)`,
                transform:
                  i === 0
                    ? `rotate(-8deg) translateX(${offset}px)`
                    : i === 2
                      ? `rotate(8deg) translateX(${offset}px)`
                      : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                zIndex: isCenter ? 1 : 0
              }}
            >
              {a.content}
            </div>
          )
        })}
      </div>
      <div className="text-foreground text-sm font-semibold">{title}</div>
      {description && (
        <div className="text-muted-foreground text-ui mt-1 max-w-[280px]">
          {description}
        </div>
      )}
      {action && (
        <Button
          size="sm"
          onClick={action.onClick}
          className="mt-4 rounded-full"
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}
