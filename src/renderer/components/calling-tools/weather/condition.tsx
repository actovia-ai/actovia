import {
  conditionNameOf,
  type WeatherConditionName
} from '@actovia/shared/types/weather'
import {
  CloudIcon,
  CloudDrizzleIcon,
  CloudFogIcon,
  CloudLightningIcon,
  CloudMoon,
  CloudRainIcon,
  CloudSnowIcon,
  CloudSun,
  MoonIcon,
  Sun03Icon
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'

/**
 * A WMO weather code (what Open-Meteo returns) → the icon that stands for
 * it. The icon's tint is the one place the condition gets a colour: the card
 * itself is tokens only, and the curve follows the colour tone's accent
 * (`primary`).
 */
export interface Condition {
  Icon: IconSvgElement
  tint: string
}

const CONDITIONS: Record<WeatherConditionName, Condition> = {
  Sunny: { Icon: Sun03Icon, tint: 'text-amber-500' },
  PartlyCloudy: { Icon: CloudSun, tint: 'text-amber-500/80' },
  Cloudy: { Icon: CloudIcon, tint: 'text-muted-foreground' },
  Fog: { Icon: CloudFogIcon, tint: 'text-muted-foreground' },
  LightShowers: { Icon: CloudDrizzleIcon, tint: 'text-sky-500' },
  LightSleet: { Icon: CloudSnowIcon, tint: 'text-sky-400' },
  LightSnow: { Icon: CloudSnowIcon, tint: 'text-sky-400' },
  LightSnowShowers: { Icon: CloudSnowIcon, tint: 'text-sky-400' },
  HeavySnow: { Icon: CloudSnowIcon, tint: 'text-sky-400' },
  HeavySnowShowers: { Icon: CloudSnowIcon, tint: 'text-sky-400' },
  LightRain: { Icon: CloudRainIcon, tint: 'text-sky-500' },
  HeavyShowers: { Icon: CloudRainIcon, tint: 'text-sky-600' },
  HeavyRain: { Icon: CloudRainIcon, tint: 'text-sky-600' },
  ThunderyShowers: { Icon: CloudLightningIcon, tint: 'text-violet-500' },
  ThunderyHeavyRain: { Icon: CloudLightningIcon, tint: 'text-violet-500' }
}

/** A clear or partly cloudy night is a moon, not a sun. */
const NIGHT: Partial<Record<WeatherConditionName, Condition>> = {
  Sunny: { Icon: MoonIcon, tint: 'text-muted-foreground' },
  PartlyCloudy: { Icon: CloudMoon, tint: 'text-muted-foreground' }
}

export function conditionOf(weatherCode: string, isDay = true): Condition {
  const name = conditionNameOf(weatherCode)
  return (isDay ? undefined : NIGHT[name]) ?? CONDITIONS[name]
}
