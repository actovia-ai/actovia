import {
  DeepResearchProgress,
  Learning,
  QueryWithResearchGoal,
  ReportProgressPayload
} from '@actovia/shared/types/deep-research'
import { WebSearchResult } from '@actovia/shared/types/web-search'
import type { Model } from '@earendil-works/pi-ai'

import { generateSerpQueries } from './generate-queries'
import { processSerpResult } from './process-search-results'
import { webSearch } from './web-search'

export async function deepResearch(
  { query, breadth, depth }: { query: string; breadth: number; depth: number },
  {
    model,
    apiKey,
    braveApiKey,
    notify
  }: {
    model: Model<string>
    apiKey: string
    braveApiKey: string
    notify: (payload: ReportProgressPayload) => Promise<void>
  }
) {
  const learnings: Learning[] = []
  const webSources: Map<string, WebSearchResult> = new Map()
  const serpQueries = await generateSerpQueries({ query }, { model, apiKey })

  await notify({
    type: DeepResearchProgress.EmitSearchQueries,
    query,
    searchQueries: serpQueries
  })

  for (const serpQuery of serpQueries) {
    await recursiveDeepResearch(
      {
        topic: query,
        serpQuery,
        breadth,
        depth,
        learnings,
        webSources
      },
      {
        notify,
        braveApiKey,
        model,
        apiKey
      }
    )
  }

  return { learnings, webSources }
}

async function recursiveDeepResearch(
  {
    topic,
    serpQuery,
    breadth,
    depth,
    learnings = [],
    webSources = new Map()
  }: {
    /** What the user asked to research: the language the learnings are written in. */
    topic: string
    serpQuery: QueryWithResearchGoal
    breadth: number
    depth: number
    learnings?: Learning[]
    webSources?: Map<string, WebSearchResult>
  },
  {
    braveApiKey,
    model,
    apiKey,
    notify
  }: {
    notify: (payload: ReportProgressPayload) => Promise<void>
    braveApiKey: string
    model: Model<string>
    apiKey: string
  }
) {
  if (depth <= 0 || breadth <= 0) return

  const searchResults = await webSearch(
    {
      query: serpQuery.query,
      webSources
    },
    { braveApiKey }
  )
  if (!searchResults) return

  await notify({
    type: DeepResearchProgress.EmitSearchResults,
    webSearchResults: searchResults,
    query: serpQuery.query
  })

  const newBreadth = Math.ceil(breadth / 2)
  const newDepth = depth - 1

  const newLearningsResult = await processSerpResult(
    {
      topic,
      query: serpQuery.query,
      searchResults,
      numFollowUpQuestions: newBreadth
    },
    { model, apiKey }
  )

  await notify({
    type: DeepResearchProgress.EmitLearnings,
    learnings: newLearningsResult.learnings
  })

  learnings.push(...newLearningsResult.learnings)
  searchResults.forEach((searchResult) =>
    webSources.set(searchResult.link, { ...searchResult })
  )

  const subQuery = [
    `Previous research goal: ${serpQuery.researchGoal}`,
    `Follow-up research directions:`,
    ...newLearningsResult.followUpQuestions.map((q) => `- ${q}`)
  ].join('\n')

  const subSerpQueries = await generateSerpQueries(
    {
      query: subQuery,
      learnings,
      numQueries: newBreadth
    },
    { model, apiKey }
  )

  await notify({
    type: DeepResearchProgress.EmitSearchQueries,
    query: subQuery,
    searchQueries: subSerpQueries,
    deeper: true
  })

  for (const subSerpQuery of subSerpQueries) {
    await recursiveDeepResearch(
      {
        topic,
        serpQuery: subSerpQuery,
        breadth: newBreadth,
        depth: newDepth,
        learnings,
        webSources
      },
      {
        notify,
        braveApiKey,
        model,
        apiKey
      }
    )
  }
}
