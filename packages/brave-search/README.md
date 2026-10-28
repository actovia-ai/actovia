# @actovia-ai/brave-search

A small client for the [Brave Search API](https://api-dashboard.search.brave.com),
in plain TypeScript over `fetch`: no dependencies, nothing tied to Node,
Electron or Actovia. It runs anywhere `fetch` does.

```ts
import {
  createBraveClient,
  llmContext,
  richHint,
  richSearch,
  richToSource,
  webSearch
} from '@actovia-ai/brave-search'

const brave = createBraveClient({ apiKey: process.env.BRAVE_API_KEY! })

// Pages to ground a model on, with their text already extracted.
const ctx = await llmContext(brave, {
  query: 'rust async runtimes',
  sources: 10,
  maxTokens: 8192,
  maxTokensPerSource: 2048
})

// Structured data — weather, a stock, a score — when Brave has some.
const web = await webSearch(brave, { query: 'kospi today', richCallback: true })
const hint = richHint(web)
if (hint) {
  const data = richToSource(await richSearch(brave, hint.callbackKey))
  console.log(data?.vertical, data?.provider, data?.json)
}
```

## What is in it

| Export                                                           | What it does                                                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `createBraveClient({ apiKey, fetch?, baseUrl?, retryDelayMs? })` | Asks for gzip, retries a 429 once, throws `BraveSearchError` for a non-2xx          |
| `llmContext`                                                     | `llm/context`: grounding sources with token budgets, source metadata, no spellcheck |
| `webSearch`                                                      | `web/search`: web, news and discussions, extra snippets, optional rich callback     |
| `richSearch`                                                     | `web/rich`: the structured data a callback key names                                |
| `imageSearch`, `videoSearch`, `newsSearch`                       | The media and news endpoints                                                        |
| `webResultsToSources`                                            | Web, news and discussion results as one list, each url once                         |
| `imageResultsToMedia`, `videoResultsToMedia`                     | Media results, each picture once whatever its rendition                             |
| `newsArticles`, `freshest`, `withoutSourceSuffix`                | News with a publication time, the newest first, titles without the outlet's tail    |
| `richHint`, `richToSource`                                       | The rich hint of a search; rich data with the empty fields dropped, bounded         |
| `plainTitle`, `pickAgeLabel`, `siteOf`, `pageKey`, `runLimited`  | Small helpers the mapping uses                                                      |

A `BraveSearchError` carries `failure` (`rate_limited`, `unauthorized`,
`quota`, `http`) and `status`; its message never holds the query or the key.
A request that never got an answer throws what `fetch` threw.

Tests: `tests/unit/packages/brave-search/` in the Actovia repository.
