import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { webFetch } from '@main/lib/ai/calling-tools/web-fetch'
import { afterEach, describe, expect, it, vi } from 'vitest'

const loadDocument = vi.fn()
vi.mock('@main/lib/ai/utils/web-search-util', () => ({
  loadDocument: (...a: unknown[]) => loadDocument(...a)
}))

afterEach(() => loadDocument.mockReset())

describe('webFetch', () => {
  it('registers the page in the shared rank map and prefixes a [N] header', async () => {
    loadDocument.mockResolvedValue({
      ogImage: 'https://img/og.png',
      type: 'html',
      content: '# BLS PPI Release\n\nFinal demand rose 0.4 percent in August.'
    })
    const sources = new Map<string, WebSearchResult>()
    const tool = webFetch(sources)
    const out = await tool.execute('c1', { url: 'https://www.bls.gov/x.htm' })

    expect(sources.get('https://www.bls.gov/x.htm')).toMatchObject({
      rank: 1,
      link: 'https://www.bls.gov/x.htm',
      title: 'BLS PPI Release',
      hostname: 'bls.gov',
      thumbnail: 'https://img/og.png'
    })
    const text = out.content[0].type === 'text' ? out.content[0].text : ''
    expect(text).toContain('[1] BLS PPI Release')
    expect(text).toContain('【1-source】')
    expect(text).toContain('Final demand rose 0.4 percent')
  })

  it("numbers the page after the sources of the chat's earlier runs", async () => {
    // The registry is made anew for every request; without a base, a page
    // fetched in a later run is [1] again and its 【1-source】 cannot be told
    // from the first run's.
    loadDocument.mockResolvedValue({
      ogImage: '',
      type: 'html',
      content: 'body'
    })
    const sources = new Map<string, WebSearchResult>()
    const out = await webFetch(sources, 12).execute('c1', {
      url: 'https://a.example/x'
    })

    expect(sources.get('https://a.example/x')?.rank).toBe(13)
    const text = out.content[0].type === 'text' ? out.content[0].text : ''
    expect(text).toContain('【13-source】')
  })

  it('reuses the existing rank when the same URL is fetched twice', async () => {
    loadDocument.mockResolvedValue({
      ogImage: '',
      type: 'html',
      content: 'body'
    })
    const sources = new Map<string, WebSearchResult>([
      ['https://a.com', { rank: 3 } as WebSearchResult]
    ])
    const tool = webFetch(sources)
    const out = await tool.execute('c1', { url: 'https://a.com' })
    expect(sources.size).toBe(1)
    const text = out.content[0].type === 'text' ? out.content[0].text : ''
    expect(text).toContain('【3-source】')
  })

  it('works without a rank map (no header, plain details)', async () => {
    loadDocument.mockResolvedValue({ ogImage: '', type: 'html', content: 'hi' })
    const out = await webFetch().execute('c1', { url: 'https://a.com' })
    const text = out.content[0].type === 'text' ? out.content[0].text : ''
    expect(text).toBe('hi')
    expect(out.details).toEqual({ url: 'https://a.com', length: 2 })
  })

  it('throws when the fetch fails', async () => {
    loadDocument.mockResolvedValue(null)
    await expect(
      webFetch().execute('c1', { url: 'https://a.com' })
    ).rejects.toThrow('Failed to fetch')
  })

  it.each(['file:///etc/passwd', 'data:text/html,<b>x</b>', 'ftp://a.com/f'])(
    'refuses %s — only http and https (S5)',
    async (url) => {
      await expect(webFetch().execute('c1', { url })).rejects.toThrow(
        /only http and https/u
      )
      expect(loadDocument).not.toHaveBeenCalled()
    }
  )

  describe('cannot reach Actovia’s own API', () => {
    it.each([
      'http://127.0.0.1:60223/api/v1/settings',
      'http://localhost:60223/api/v1/settings',
      'http://[::1]:63129/api/v1/pair',
      'http://127.0.0.1:63129/api/v1/pair'
    ])('refuses %s without ever loading it', async (url) => {
      await expect(webFetch().execute('c1', { url })).rejects.toThrow(
        'Actovia cannot fetch its own API.'
      )
      expect(loadDocument).not.toHaveBeenCalled()
    })

    it('allows a different port on the same loopback address', async () => {
      loadDocument.mockResolvedValue({
        ogImage: '',
        type: 'html',
        content: 'a local dev server'
      })
      const out = await webFetch().execute('c1', {
        url: 'http://127.0.0.1:3000/x'
      })
      const text = out.content[0].type === 'text' ? out.content[0].text : ''
      expect(text).toContain('a local dev server')
      expect(loadDocument).toHaveBeenCalledWith(
        'http://127.0.0.1:3000/x',
        undefined
      )
    })
  })
})
