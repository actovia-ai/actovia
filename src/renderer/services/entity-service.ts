import type { EntitySummary } from '@actovia/shared/types/entity'
import { fetcher } from '@actovia/shared/utils/http'

/** Wikipedia's summary of `title` in `lang` (then English), through the computer's `GET /api/v1/entity/:title`. */
export const getEntitySummary = (title: string, lang: string) =>
  fetcher<EntitySummary>(
    `/api/v1/entity/${encodeURIComponent(title)}?lang=${encodeURIComponent(lang)}`
  )
