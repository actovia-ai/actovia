import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { WeatherResult } from '@actovia/shared/types/weather'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  Type,
  fauxProvider,
  type FauxProviderHandle,
  type RegisterFauxProviderOptions
} from '@earendil-works/pi-ai'

import { getKernelModels } from './models'

/**
 * pi's scripted provider, registered on the kernel's collection. Unit tests
 * script replies with `setResponses([...])`; the Electron e2e registers it at
 * boot when `ACTOVIA_FAUX_PROVIDER=1` (`faux-boot.ts`).
 */
export function registerFauxProvider(
  options?: RegisterFauxProviderOptions
): FauxProviderHandle {
  const handle = fauxProvider(options)
  getKernelModels().setProvider(handle.provider)
  return handle
}

// ── The e2e switch's state, kept free of the logger so the modules that
// consult it (model resolution, tool binding) import nothing Electron-bound.

let booted: FauxProviderHandle | null = null

/** The handle `faux-boot.ts` registered, while the e2e's provider is on. */
export function fauxHandle(): FauxProviderHandle | null {
  return booted
}

export function setFauxHandle(handle: FauxProviderHandle | null): void {
  booted = handle
}

const weatherSchema = Type.Object({ location: Type.String() })

/**
 * Stands in for the real `weather` tool (Open-Meteo) while the faux provider is
 * on. Its `details` are a whole `WeatherResult`, since `WeatherCard` renders
 * them: a fixed sunny day, no forecast.
 */
export const fauxWeatherTool: AgentTool<typeof weatherSchema> = {
  name: TOOL_NAMES.weather,
  label: 'Weather',
  description: 'Current weather for a location (faux).',
  parameters: weatherSchema,
  execute: async (_toolCallId, { location }) => {
    const details: WeatherResult = {
      location,
      current: {
        condition: 'Sunny',
        weatherCode: '0',
        tempC: '21',
        feelsLikeC: '21',
        humidity: '40',
        windKmph: '8',
        windDirDegree: '180',
        windDir: 'S',
        precipMM: '0.0',
        uvIndex: '5',
        visibility: '10',
        pressure: '1015',
        observedAt: '2026-09-22T12:00',
        isDay: true
      },
      forecast: []
    }
    return {
      content: [{ type: 'text', text: `sunny in ${location}` }],
      details
    }
  }
}
