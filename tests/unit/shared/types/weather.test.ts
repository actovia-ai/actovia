import {
  conditionNameOf,
  weatherClockHours
} from '@actovia/shared/types/weather'
import { describe, expect, it } from 'vitest'

describe('weatherClockHours', () => {
  it("reads Open-Meteo's ISO local times", () => {
    expect(weatherClockHours('2026-09-23T06:02')).toBeCloseTo(6 + 2 / 60)
    expect(weatherClockHours('2026-09-23T18:30')).toBe(18.5)
  })

  it('gives null for anything else, so a label falls back to the raw text', () => {
    expect(weatherClockHours('')).toBeNull()
    expect(weatherClockHours('noon')).toBeNull()
  })
})

describe('conditionNameOf', () => {
  it('reads WMO codes and defaults to Cloudy', () => {
    expect(conditionNameOf('0')).toBe('Sunny')
    expect(conditionNameOf('3')).toBe('Cloudy')
    expect(conditionNameOf('95')).toBe('ThunderyShowers')
    expect(conditionNameOf('63')).toBe('LightRain')
    expect(conditionNameOf('4242')).toBe('Cloudy')
  })
})
