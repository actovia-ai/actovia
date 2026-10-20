import { fetcher } from '@actovia/shared/utils/http'

export interface DailyCost {
  date: string
  cost: number
  tokens: number
}

export interface ModelCost {
  model: string
  provider: string
  cost: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  requests: number
}

export interface UsageSummary {
  totalCost: number
  totalTokens: number
  totalRequests: number
  daily: DailyCost[]
  models: ModelCost[]
}

export const getUsageSummary = () => fetcher<UsageSummary>('/api/v1/usage')
