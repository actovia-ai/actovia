import type { PmRoundEventDto } from '@exodus/shared/types/pm-round'
import { fetcher } from '@exodus/shared/utils/http'

/** A PM round's decision trail, in order (404 when nothing was recorded). */
export const getPmRound = (conversationId: string, roundId: string) =>
  fetcher<PmRoundEventDto[]>(
    `/api/v1/philharmonic/conversations/${conversationId}/rounds/${roundId}`
  )
