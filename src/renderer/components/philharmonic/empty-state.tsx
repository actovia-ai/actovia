import { HugeiconsIcon } from '@hugeicons/react'

import { MusicConductor } from '@/components/icons/music-conductor'
import { Button } from '@/components/ui/button'

interface Props {
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

const STAFF_LINES = [0, 1, 2, 3, 4]

/**
 * Philharmonic's mark (owner, ISSUE-272, in place of the three hue bubbles):
 * the conductor in a round tile, standing on a five-line staff that fades out
 * at both ends — the workspace glyph, set as a score.
 */
function ConductorMark() {
  return (
    <div className="relative mb-4 flex h-14 w-44 items-center justify-center">
      <svg
        aria-hidden
        className="text-border absolute inset-0 size-full [mask-image:linear-gradient(to_right,transparent,black_30%,black_70%,transparent)]"
        viewBox="0 0 176 56"
        preserveAspectRatio="none"
      >
        {STAFF_LINES.map((i) => (
          <line
            key={i}
            x1="0"
            x2="176"
            y1={12 + i * 8}
            y2={12 + i * 8}
            stroke="currentColor"
            strokeWidth="1"
          />
        ))}
      </svg>
      <div className="bg-background ring-border text-foreground relative flex size-14 items-center justify-center rounded-full shadow-sm ring-1">
        <HugeiconsIcon icon={MusicConductor} className="size-7" />
      </div>
    </div>
  )
}

export function PhilharmonicEmptyState({ title, description, action }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <ConductorMark />
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
