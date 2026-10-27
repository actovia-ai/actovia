import { fetcher } from '@actovia/shared/utils/http'

export interface DailyUsage {
  date: string
  tokens: number
}

export interface ModelUsage {
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalTokens: number
  requests: number
}

export interface UsageSummary {
  totalTokens: number
  totalRequests: number
  daily: DailyUsage[]
  models: ModelUsage[]
}

export const getUsageSummary = () => fetcher<UsageSummary>('/api/v1/usage')
