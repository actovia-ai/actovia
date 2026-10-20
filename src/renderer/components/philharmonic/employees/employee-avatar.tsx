import {
  type AvatarStyle,
  DEFAULT_AVATAR_STYLE
} from '@actovia/shared/constants/avatar'
import { Avatar, Style } from '@dicebear/core'
import adventurer from '@dicebear/styles/adventurer.json'
import notionists from '@dicebear/styles/notionists.json'
import thumbs from '@dicebear/styles/thumbs.json'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { hueStyle, pickHue, type HueName } from '../lib/hue'

// DiceBear v10 renders JSON style definitions (`@dicebear/styles`) through a
// `Style` instance; constructing one validates the schema, so build each
// style once and reuse it across every avatar.
const DEFINITIONS: Record<AvatarStyle, unknown> = {
  notionists,
  thumbs,
  adventurer
}
const styles = new Map<AvatarStyle, Style>()

function resolveStyle(style: string | null): Style {
  const key =
    style && style in DEFINITIONS
      ? (style as AvatarStyle)
      : DEFAULT_AVATAR_STYLE
  let instance = styles.get(key)
  if (!instance) {
    instance = new Style(DEFINITIONS[key])
    styles.set(key, instance)
  }
  return instance
}

export function EmployeeAvatar({
  seed,
  style,
  size = 36,
  hue,
  ring = true,
  className
}: {
  seed: string | null
  style: string | null
  size?: number
  hue?: HueName
  ring?: boolean
  className?: string
}) {
  const { t } = useTranslation('philharmonic')
  const dataUri = useMemo(
    () =>
      new Avatar(resolveStyle(style), { seed: seed ?? 'default' }).toDataUri(),
    [seed, style]
  )

  const resolvedHue = hue ?? pickHue(seed ?? 'default')
  const wrapperStyle = ring ? hueStyle(resolvedHue) : undefined

  return (
    <div
      className={cn('relative inline-flex shrink-0 rounded-full', className)}
      style={{ width: size, height: size, ...wrapperStyle }}
    >
      <img
        src={dataUri}
        width={size}
        height={size}
        className="rounded-full"
        alt={t('employees.avatar.alt')}
      />
    </div>
  )
}
