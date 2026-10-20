import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { describe, expect, it } from 'vitest'

import { collectGalleryVideos } from '@/components/web-search/collect-gallery-videos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function res(media: any): WebSearchResult {
  return { rank: 1, link: 'x', title: 't', content: '', snippet: '', media }
}

describe('collectGalleryVideos', () => {
  it('keeps only videos and dedups by url (first wins)', () => {
    const out = collectGalleryVideos([
      res([
        {
          kind: 'video',
          title: 'A',
          url: 'v1',
          sourceUrl: 'v1',
          thumbnailUrl: 't1',
          duration: '1:23',
          source: 'Ch'
        },
        { kind: 'image', title: 'I', url: 'i1', sourceUrl: 'i1' }
      ]),
      res([
        { kind: 'video', title: 'A dup', url: 'v1', sourceUrl: 'v1' },
        { kind: 'video', title: 'B', url: 'v2', sourceUrl: 'v2' }
      ])
    ])
    expect(out.map((v) => v.url)).toEqual(['v1', 'v2'])
    expect(out[0].thumbnailUrl).toBe('t1')
    expect(out[0].duration).toBe('1:23')
  })

  it('falls back thumbnailUrl→url and drops url-less entries', () => {
    const out = collectGalleryVideos([
      res([
        { kind: 'video', title: 'C', url: 'v3', sourceUrl: 'v3' },
        { kind: 'video', title: 'no-url', url: '', sourceUrl: 'x' }
      ])
    ])
    expect(out).toHaveLength(1)
    expect(out[0].thumbnailUrl).toBe('v3')
  })

  it('handles missing media', () => {
    expect(collectGalleryVideos([res()])).toEqual([])
  })
})
