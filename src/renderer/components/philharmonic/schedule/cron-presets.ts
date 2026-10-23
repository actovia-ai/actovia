/** The schedules the form offers by name; anything else is a custom cron line. */
export const CRON_PRESETS = [
  { key: 'dailyNine', value: '0 9 * * *' },
  { key: 'mondayNine', value: '0 9 * * 1' }
] as const

export type CronPresetKey = (typeof CRON_PRESETS)[number]['key']

/** The preset a cron line is, if it is one. */
export function cronPresetKey(cron: string): CronPresetKey | null {
  return CRON_PRESETS.find((p) => p.value === cron.trim())?.key ?? null
}
