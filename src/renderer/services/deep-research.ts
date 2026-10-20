import { fetcher } from '@actovia/shared/utils/http'

import { DeepResearch, DeepResearchMessage } from '@/types/db'

export const fetchDeepResearchResult = async (id: string) => {
  return await fetcher<DeepResearch>(`/api/v1/deep-research/result/${id}`, {
    method: 'GET'
  })
}

export const fetchDeepResearchMessages = async (id: string) => {
  return await fetcher<DeepResearchMessage[]>(
    `/api/v1/deep-research/messages/${id}`,
    {
      method: 'GET'
    }
  )
}
