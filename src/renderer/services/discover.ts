import type { DiscoverFeedDto } from '@actovia/shared/types/discover'
import { fetcher } from '@actovia/shared/utils/http'

export const getDiscoverFeed = () =>
  fetcher<DiscoverFeedDto>('/api/v1/discover')

export const refreshDiscoverFeed = () =>
  fetcher<DiscoverFeedDto>('/api/v1/discover/refresh', { method: 'POST' })
