import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { describe, expect, it } from 'vitest'

import { collectGalleryImages } from '@/components/web-search/collect-gallery-images'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function res(media: any): WebSearchResult {
  return { rank: 1, link: 'x', title: 't', content: '', snippet: '', media }
}

describe('collectGalleryImages', () => {
  it('keeps only images and dedups by url (first wins)', () => {
    const out = collectGalleryImages([
      res([
        {
          kind: 'image',
          title: 'A',
          url: 'u1',
          sourceUrl: 's1',
          thumbnailUrl: 't1'
        },
        { kind: 'video', title: 'V', url: 'v1', sourceUrl: 'sv' }
      ]),
      res([
        {
          kind: 'image',
          title: 'A dup',
          url: 'u1',
          sourceUrl: 's1',
          thumbnailUrl: 't1b'
        },
        {
          kind: 'image',
          title: 'B',
          url: 'u2',
          sourceUrl: 's2',
          thumbnailUrl: 't2'
        }
      ])
    ])
    expect(out.map((i) => i.url)).toEqual(['u1', 'u2'])
    expect(out[0].thumbnailUrl).toBe('t1')
  })

  // Only the copy Brave fetched is ever shown: a site's own file may refuse
  // to be hotlinked, be gone, or not answer (owner, 2026-09-30). An image
  // with no thumbnail is not shown at all.
  it('drops an image the search gave no thumbnail for', () => {
    const out = collectGalleryImages([
      res([
        { kind: 'image', title: 'C', url: 'u3', sourceUrl: 's3' },
        {
          kind: 'image',
          title: 'no-url',
          url: '',
          sourceUrl: 's4',
          thumbnailUrl: 't4'
        }
      ])
    ])
    expect(out).toEqual([])
  })

  it('handles missing media', () => {
    expect(collectGalleryImages([res()])).toEqual([])
  })
})
