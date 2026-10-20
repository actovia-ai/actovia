import { TOOL_NAMES, type ToolName } from '@actovia/shared/constants/tool-names'
import type {
  SettingsInput,
  UseFormReturnType
} from '@actovia/shared/schemas/settings-schema'
import type { ParseKeys } from 'i18next'
import type { ComponentType } from 'react'
import type { FieldPath } from 'react-hook-form'

import { GoogleMaps } from './google-maps'
import { ImageGeneration } from './image-generation'
import { WebSearch } from './web-search'

/**
 * The tools that have something to configure, keyed by their wire name —
 * `TOOL_REGISTRY`'s keys, so the Built-in Tools page can look a row's panel
 * up. (Keyed by the old camelCase names once, which the snake_case rename
 * silently orphaned: the panels vanished with no error — hence the test.)
 */
export interface ToolConfig {
  Panel: ComponentType<{ form: UseFormReturnType }>
  /**
   * The one field without which the tool cannot work, and the line to show
   * under the row while the tool is on and the field is empty.
   */
  needs: { field: FieldPath<SettingsInput>; hintKey: ParseKeys<'settings'> }
}

export const TOOL_CONFIG: Partial<Record<ToolName, ToolConfig>> = {
  [TOOL_NAMES.webSearch]: {
    Panel: WebSearch,
    needs: {
      field: 'webSearch.braveApiKey',
      hintKey: 'tools.needsKey.webSearch'
    }
  },
  [TOOL_NAMES.imageGeneration]: {
    Panel: ImageGeneration,
    needs: {
      field: 'providers.openaiApiKey',
      hintKey: 'tools.needsKey.imageGeneration'
    }
  },
  [TOOL_NAMES.mapItinerary]: {
    Panel: GoogleMaps,
    needs: {
      field: 'googleCloud.googleApiKey',
      hintKey: 'tools.needsKey.mapItinerary'
    }
  }
}
