import type { PmRoundEventDto } from '@actovia/shared/types/pm-round'
import { fetcher } from '@actovia/shared/utils/http'

/** A PM round's decision trail, in order (404 when nothing was recorded). */
export const getPmRound = (conversationId: string, roundId: string) =>
  fetcher<PmRoundEventDto[]>(
    `/api/v1/philharmonic/conversations/${conversationId}/rounds/${roundId}`
  )
