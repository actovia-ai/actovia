import { richHint, richToSource } from '@actovia-ai/brave-search'
import { describe, expect, it } from 'vitest'

describe('richHint', () => {
  it('reads the vertical and the callback key', () => {
    expect(
      richHint({
        rich: {
          type: 'rich',
          hint: { vertical: 'stocks', callback_key: 'f5f8' }
        }
      })
    ).toEqual({ vertical: 'stocks', callbackKey: 'f5f8' })
  })

  it('is null without a key', () => {
    expect(richHint({})).toBeNull()
    expect(richHint(null)).toBeNull()
    expect(richHint({ rich: { type: 'rich', hint: {} } })).toBeNull()
  })
})

describe('richToSource', () => {
  const weather = {
    type: 'rich',
    response_callback_info: {
      vertical: 'weather',
      callback_key: 'k',
      callback_status: 'success'
    },
    results: [
      {
        type: 'rich',
        subtype: 'weather',
        provider: { name: 'OpenWeather', url: 'https://openweathermap.org' },
        weather: {
          location: { name: 'Beijing', country: 'CN' },
          current_weather: { temp: 18.5, feels_like: null, description: '' },
          hours3: Array.from({ length: 40 }, (_, i) => ({ hour: i }))
        }
      }
    ]
  }

  it('names the vertical and the provider', () => {
    const source = richToSource(weather)

    expect(source).toMatchObject({
      vertical: 'weather',
      provider: 'OpenWeather',
      providerUrl: 'https://openweathermap.org'
    })
  })

  it('keeps the figures and drops what is empty', () => {
    const source = richToSource(weather)!
    const data = JSON.parse(source.json) as {
      weather: { current_weather: Record<string, unknown> }
    }[]

    expect(data[0].weather.current_weather).toEqual({ temp: 18.5 })
    expect(source.json).not.toContain('provider')
  })

  it('cuts a long series to its first entries', () => {
    const source = richToSource(weather, { maxItems: 8 })!
    const data = JSON.parse(source.json) as {
      weather: { hours3: unknown[] }
    }[]

    expect(data[0].weather.hours3).toHaveLength(8)
  })

  it('bounds the text', () => {
    const source = richToSource(weather, { maxChars: 120 })!

    expect(source.json.length).toBeLessThanOrEqual(120)
    expect(source.truncated).toBe(true)
  })

  it('is null for a failed callback or no results', () => {
    expect(
      richToSource({
        ...weather,
        response_callback_info: {
          ...weather.response_callback_info,
          callback_status: 'failure'
        }
      })
    ).toBeNull()
    expect(richToSource({ type: 'rich', results: [] })).toBeNull()
    expect(richToSource(null)).toBeNull()
  })
})
