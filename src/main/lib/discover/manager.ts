import type { DiscoverGroup } from '@actovia/shared/types/discover'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { LOCAL_USER_ID } from '../ai/memory/manager'
import { completeSimple } from '../ai/utils/complete'
import {
  extractTextFromCompletion,
  parseJsonFromLlmResponse
} from '../ai/utils/llm-response-util'
import { getModelFromProvider } from '../ai/utils/model-util'
import { db } from '../db/db'
import { getDiscoverFeed, setDiscoverFeed } from '../db/discover-queries'
import { getActiveMemories, type MemoryRow } from '../db/memory-queries'
import { getSettings } from '../db/queries'
import { discoverFeed } from '../db/schema'
import { logger } from '../logger'
import {
  freshest,
  type PooledNewsArticle,
  searchBraveNews
} from './brave-news-client'

const STALE_AFTER_MS = 20 * 60 * 60 * 1000 // ~20h

const DISCOVER_QUERY_SYSTEM = `You turn a user's personal memory entries into news-search queries for a "what's new" feed that refreshes daily.

For each memory, find the BROAD ONGOING SUBJECT behind it — the franchise, company, field, product line, team, or person the user follows — and write ONE news query for that subject, plus a 2-4 word topic label for display.

Pitch the query so it keeps returning fresh, different stories week after week. Test it: "would this return genuinely new results a month from now?"
- Good: "The Legend of Zelda series news", "Nvidia AI data center news", "semiconductor industry news", "Formula 1 news"
- Bad — a specific release, product, event, or settled fact: "Zelda Switch 2 preorder date", "RTX 5090 price", "iPhone 17 review". Those have fixed answers; they are not news.
- Never put "release date", "price", "preorder", "specs", "review", "how to", "vs", or "guide" in a query.

If the memory has no news angle — a personal habit, a skill they practice, a local or private setup, a plain preference (language-study progress, home-network configuration) — set "query" to null.

Return ONLY JSON matching this shape, one entry per memory given, in the same order:
{"items":[{"memoryId":"<id>","topic":"<short label>","query":"<search query>"},{"memoryId":"<id>","topic":"<short label>","query":null}]}`

const discoverItemSchema = z.object({
  memoryId: z.string(),
  topic: z.string().min(1),
  query: z.string().min(1).nullable().optional()
})

const DISCOVER_JUDGE_SYSTEM = `You check news search results against the subject a user follows. For each numbered topic you get its search results, numbered. Keep a result only when it is news about that subject itself: not a passing mention, not another place, team, company or field that shares a word with it, not a tutorial, listicle or evergreen guide.

Return ONLY JSON: {"topics":[{"topic":1,"keep":[2,5]},{"topic":2,"keep":[]}]} — every topic given, by its number, with the numbers of the results to keep (an empty list when none fits).`

const judgeSchema = z.object({
  topics: z.array(
    z.object({ topic: z.number().int(), keep: z.array(z.number().int()) })
  )
})

/**
 * Which pool articles are about their topic, per topic, as indexes into its
 * pool; `null` when the judge's answer could not be read. One call for all
 * topics, once a refresh (~daily). Brave News fills a thin pool with loose
 * matches, so what it returns cannot be shown as it comes.
 */
async function judgeRelevance(
  model: Parameters<typeof completeSimple>[0],
  apiKey: string | undefined,
  topics: { topic: string; query: string; pool: PooledNewsArticle[] }[]
): Promise<Set<number>[] | null> {
  const prompt = topics
    .map(({ topic, query, pool }, t) => {
      const lines = pool
        .map(
          (a, i) =>
            `  ${i + 1}. ${a.title}${a.description ? ` — ${a.description.slice(0, 200)}` : ''}`
        )
        .join('\n')
      return `Topic ${t + 1}: ${topic} (searched as "${query}")\n${lines}`
    })
    .join('\n\n')
  try {
    const result = await completeSimple(
      model,
      {
        systemPrompt: DISCOVER_JUDGE_SYSTEM,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
            timestamp: Date.now()
          }
        ]
      },
      { apiKey }
    )
    const parsed = parseJsonFromLlmResponse<z.infer<typeof judgeSchema> | null>(
      extractTextFromCompletion(result.content),
      judgeSchema,
      null
    )
    if (!parsed) return null
    const keep = topics.map(() => new Set<number>())
    for (const { topic, keep: kept } of parsed.topics) {
      const set = keep[topic - 1]
      if (!set) continue
      for (const n of kept) if (n >= 1) set.add(n - 1)
    }
    return keep
  } catch (error) {
    logger.warn('discover', 'Relevance check failed; showing Brave order', {
      error
    })
    return null
  }
}

// The top level only guarantees an `items` array — each element is validated
// individually below so one malformed entry can't reject the whole response.
const discoverEnvelopeSchema = z.object({ items: z.array(z.unknown()) })

function formatMemoryForPrompt(m: MemoryRow): string {
  const details = (m.details ?? [])
    .slice(0, 2)
    .map((d) => `\n  - ${d}`)
    .join('')
  return `- id: ${m.id}\n  key: ${m.key}\n  summary: ${m.summary}${details}`
}

function recencyMs(m: MemoryRow): number {
  return (m.lastUsedAt ?? m.updatedAt ?? new Date(0)).getTime()
}

export async function runDiscoverRefresh(
  opts: { force?: boolean } = {}
): Promise<void> {
  const settings = await getSettings()
  if (!settings.discover?.enabled) return
  const braveApiKey = settings.webSearch?.braveApiKey
  if (!braveApiKey) return

  const current = await getDiscoverFeed()
  if (!opts.force && current.generatedAt) {
    if (Date.now() - current.generatedAt.getTime() < STALE_AFTER_MS) return
  }

  await setDiscoverFeed({ status: 'refreshing' })

  try {
    const topicCount = settings.discover.topicCount ?? 4
    const articlesPerTopic = settings.discover.articlesPerTopic ?? 3

    // Only what the user follows: where they live, who they are and the
    // people around them are not news subjects ("Beijing-based" became
    // "Beijing travel news").
    const active = (await getActiveMemories(LOCAL_USER_ID)).filter(
      (m) => m.section === 'topic'
    )
    const candidates = [...active]
      .sort((a, b) => recencyMs(b) - recencyMs(a))
      .slice(0, Math.min(active.length, topicCount + 4))

    if (candidates.length === 0) {
      await setDiscoverFeed({
        groups: [],
        generatedAt: new Date(),
        status: 'idle',
        error: null
      })
      return
    }

    const { model, apiKey } = getModelFromProvider(settings)
    const prompt = `Memories:\n${candidates.map(formatMemoryForPrompt).join('\n')}`
    const result = await completeSimple(
      model,
      {
        systemPrompt: DISCOVER_QUERY_SYSTEM,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
            timestamp: Date.now()
          }
        ]
      },
      { apiKey }
    )
    const text = extractTextFromCompletion(result.content)
    const envelope = parseJsonFromLlmResponse(text, discoverEnvelopeSchema, {
      items: []
    })

    // Validate items one by one and keep the good ones. A single bad item
    // (e.g. `query: ""`, a numeric `topic`) used to throw inside the schema
    // parse, collapse the whole response to `{ items: [] }`, and overwrite a
    // working feed with an empty one for ~20h.
    const parsedItems = envelope.items
      .map((raw) => discoverItemSchema.safeParse(raw))
      .filter(
        (r): r is { success: true; data: z.infer<typeof discoverItemSchema> } =>
          r.success
      )
      .map((r) => r.data)

    const kept = parsedItems
      .filter(
        (i): i is { memoryId: string; topic: string; query: string } =>
          typeof i.query === 'string' && i.query.trim().length > 0
      )
      .slice(0, topicCount)

    const settled = await Promise.allSettled(
      kept.map((item) =>
        searchBraveNews(braveApiKey, item.query, {
          count: articlesPerTopic,
          country: settings.webSearch?.country,
          language: settings.webSearch?.languages?.[0]
        })
      )
    )

    const searched: ((typeof kept)[number] & { pool: PooledNewsArticle[] })[] =
      []
    kept.forEach((item, idx) => {
      const outcome = settled[idx]
      if (outcome.status !== 'fulfilled') {
        logger.warn('discover', 'Brave News query failed', {
          query: item.query,
          error: outcome.reason
        })
        return
      }
      if (outcome.value.length === 0) return
      searched.push({ ...item, pool: outcome.value })
    })

    // Every query failed (a bad key, no quota, no network): that is not an
    // empty feed. Saved as one, it blanked the landing page until the feed
    // went stale (~20h) with nothing said; failing keeps the feed it had.
    const failures = settled.filter((o) => o.status === 'rejected')
    if (kept.length > 0 && failures.length === kept.length) {
      const reason = (failures[0] as PromiseRejectedResult).reason
      throw new Error(
        `Every Brave News query failed: ${reason instanceof Error ? reason.message : String(reason)}`,
        { cause: reason }
      )
    }

    // The freshest of what is about the topic; a topic left with nothing is
    // dropped. Unjudged (the check failed), Brave's own relevance order, never
    // the raw pool by recency.
    const relevant =
      searched.length > 0 ? await judgeRelevance(model, apiKey, searched) : null
    const groups: DiscoverGroup[] = []
    searched.forEach((item, t) => {
      const articles = relevant
        ? freshest(
            item.pool.filter((_, i) => relevant[t].has(i)),
            articlesPerTopic
          )
        : freshest(item.pool.slice(0, articlesPerTopic), articlesPerTopic)
      if (articles.length === 0) return
      groups.push({
        memoryId: item.memoryId,
        topic: item.topic,
        query: item.query,
        articles
      })
    })

    await setDiscoverFeed({
      groups,
      generatedAt: new Date(),
      status: 'idle',
      error: null
    })
  } catch (error) {
    await setDiscoverFeed({ status: 'failed', error: String(error) })
    throw error
  }
}

/**
 * Clears an orphaned `status:'refreshing'` on startup. If `POST /refresh` flips
 * the row to `refreshing` and the enqueue then rejects, or the process is
 * killed mid-refresh, the row can stay stuck for up to ~20h (the periodic cron
 * enqueues a non-forced job that early-returns on the staleness gate without
 * touching status, and manual refresh is blocked while `status === 'refreshing'`).
 * An in-process refresh can never legitimately survive a restart, so any row
 * still marked `refreshing` at boot is stuck and safe to reset.
 */
export async function resetStuckDiscoverRefresh(): Promise<void> {
  await db
    .update(discoverFeed)
    .set({ status: 'idle' })
    .where(eq(discoverFeed.status, 'refreshing'))
}
