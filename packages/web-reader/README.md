# @actovia-ai/web-reader

Read a web page for a model, and fetch a URL someone else chose without
letting it reach your machine or your network. For Node; the only
dependencies are `cheerio` and `turndown`.

```ts
import {
  createLocalPortGuard,
  fetchPinned,
  fetchPublicHttps,
  readPage
} from '@actovia-ai/web-reader'

// A page as Markdown: Jina Reader first, then the page fetched here.
// The guard runs before every hop, redirects included.
const guard = createLocalPortGuard({ ports: [8080] })
const doc = await readPage('https://example.com/article', {
  guard: guard.assertUrl,
  fetchHop: (url, signal) =>
    fetchPinned(url, { signal, checkAddresses: guard.assertAddresses }),
  parsePdf: async (blob) => myPdfToText(blob) // optional
})
// → { ogImage, type: 'html' | 'pdf', content } | null

// A picture an API pointed at: public https only.
const { bytes, contentType } = await fetchPublicHttps(imageUrl, {
  maxBytes: 20 * 1024 * 1024
})
```

| Export                                                                    | What it does                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readPage(link, options)`                                                 | Jina Reader, then `readDirect` when Jina has nothing                                                                                                                                                                                                                                                            |
| `readDirect(link, options)`                                               | The page fetched from this process. Redirects are followed here, with `guard(url)` asked before every hop. The main content becomes Markdown; a PDF goes through `parsePdf`. Returns null for an error page, another content type, or a failed read. What `guard` throws, or what `isRefusal` marks, is thrown. |
| `readWithJina(link)`                                                      | `https://r.jina.ai/<link>` as text                                                                                                                                                                                                                                                                              |
| `extractHtmlBody(html)` / `htmlToMarkdown(html)`                          | The main content (article, #content, main… or body), and its Markdown                                                                                                                                                                                                                                           |
| `fetchPublicHttps(url, { maxBytes })`                                     | A GET that refuses localhost, private, link-local and metadata addresses on every hop. The connection is pinned to the addresses it vetted, so DNS rebinding cannot swap them.                                                                                                                                  |
| `fetchPinned(url, { checkAddresses })`                                    | One GET pinned to the addresses `checkAddresses` judged. It never follows a redirect, and decodes and caps the body.                                                                                                                                                                                            |
| `createLocalPortGuard({ ports })`                                         | Refuses those ports on this machine (loopback, its own interfaces) and nothing else                                                                                                                                                                                                                             |
| `isPublicAddress`, `canonicalizeIp`, `resolveAddresses`, `UnsafeUrlError` | The address rules underneath                                                                                                                                                                                                                                                                                    |

MIT.
