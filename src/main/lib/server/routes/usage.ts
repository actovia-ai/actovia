import { Hono } from 'hono'

import { getUsageRows } from '../../db/queries'
import { localDateStr } from '../../local-date'
import { Variables } from '../types'
import { successResponse } from '../utils'

const usage = new Hono<{ Variables: Variables }>()

export interface DailyUsage {
  date: string // YYYY-MM-DD
  tokens: number
}

export interface ModelUsage {
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /** Every token of the model's requests, cache included — the measure Lifetime sums. */
  totalTokens: number
  requests: number
}

usage.get('/', async (c) => {
  const rows = await getUsageRows()

  let totalTokens = 0
  const totalRequests = rows.length

  const dailyMap = new Map<string, { tokens: number }>()
  const modelMap = new Map<
    string,
    {
      provider: string
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      totalTokens: number
      requests: number
    }
  >()

  for (const row of rows) {
    const u = row.usage
    if (!u) continue

    const tokens = u.totalTokens ?? 0
    totalTokens += tokens

    // Daily aggregation, by the user's day (the heatmap's keys are local)
    const date = localDateStr(row.createdAt)
    const daily = dailyMap.get(date) ?? { tokens: 0 }
    daily.tokens += tokens
    dailyMap.set(date, daily)

    // Model aggregation
    const modelKey = row.model ?? 'unknown'
    const model = modelMap.get(modelKey) ?? {
      provider: row.provider ?? 'unknown',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      requests: 0
    }
    model.inputTokens += u.input ?? 0
    model.outputTokens += u.output ?? 0
    model.cacheReadTokens += u.cacheRead ?? 0
    model.totalTokens += tokens
    model.requests += 1
    modelMap.set(modelKey, model)
  }

  // Sort daily by date ascending
  const daily: DailyUsage[] = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, tokens: v.tokens }))

  // Sort models by tokens descending
  const models: ModelUsage[] = [...modelMap.entries()]
    .sort(([, a], [, b]) => b.totalTokens - a.totalTokens)
    .map(([model, v]) => ({ model, ...v }))

  return successResponse(c, {
    totalTokens,
    totalRequests,
    daily,
    models
  })
})

export default usage
