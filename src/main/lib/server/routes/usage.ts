import { Hono } from 'hono'

import { getUsageRows } from '../../db/queries'
import { localDateStr } from '../../local-date'
import { Variables } from '../types'
import { successResponse } from '../utils'

const usage = new Hono<{ Variables: Variables }>()

export interface DailyCost {
  date: string // YYYY-MM-DD
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
  /** Every token of the model's requests, cache included — the measure Lifetime sums. */
  totalTokens: number
  requests: number
}

usage.get('/', async (c) => {
  const rows = await getUsageRows()

  let totalCost = 0
  let totalTokens = 0
  const totalRequests = rows.length

  const dailyMap = new Map<string, { cost: number; tokens: number }>()
  const modelMap = new Map<
    string,
    {
      provider: string
      cost: number
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

    const cost = u.cost?.total ?? 0
    const tokens = u.totalTokens ?? 0
    totalCost += cost
    totalTokens += tokens

    // Daily aggregation, by the user's day (the heatmap's keys are local)
    const date = localDateStr(row.createdAt)
    const daily = dailyMap.get(date) ?? { cost: 0, tokens: 0 }
    daily.cost += cost
    daily.tokens += tokens
    dailyMap.set(date, daily)

    // Model aggregation
    const modelKey = row.model ?? 'unknown'
    const model = modelMap.get(modelKey) ?? {
      provider: row.provider ?? 'unknown',
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      requests: 0
    }
    model.cost += cost
    model.inputTokens += u.input ?? 0
    model.outputTokens += u.output ?? 0
    model.cacheReadTokens += u.cacheRead ?? 0
    model.totalTokens += tokens
    model.requests += 1
    modelMap.set(modelKey, model)
  }

  // Sort daily by date ascending
  const daily: DailyCost[] = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, cost: v.cost, tokens: v.tokens }))

  // Sort models by cost descending
  const models: ModelCost[] = [...modelMap.entries()]
    .sort(([, a], [, b]) => b.cost - a.cost)
    .map(([model, v]) => ({ model, ...v }))

  return successResponse(c, {
    totalCost,
    totalTokens,
    totalRequests,
    daily,
    models
  })
})

export default usage
