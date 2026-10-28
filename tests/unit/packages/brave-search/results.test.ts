import {
  imageResultsToMedia,
  newsArticles,
  pickAgeLabel,
  plainTitle,
  videoResultsToMedia,
  webResultsToSources
} from '@actovia-ai/brave-search'
import { describe, expect, it } from 'vitest'

describe('webResultsToSources', () => {
  it('flattens web + news + discussions, deduping by url', () => {
    const flat = webResultsToSources({
      web: {
        results: [
          {
            title: 'A',
            url: 'https://a.com',
            description: 'desc a',
            extra_snippets: ['more a'],
            profile: { name: 'Site A' },
            meta_url: { hostname: 'a.com' }
          },
          { title: 'no content', url: 'https://x.com' }
        ]
      },
      news: {
        results: [{ title: 'A dup', url: 'https://a.com', description: 'dup' }]
      },
      discussions: {
        results: [
          {
            title: 'Q',
            url: 'https://forum.com/t',
            data: {
              forum_name: 'r/rust',
              num_answers: 3,
              question: 'how?',
              top_comment: 'like this'
            }
          }
        ]
      }
    })
    expect(flat.map((s) => s.url)).toEqual([
      'https://a.com',
      'https://forum.com/t'
    ])
    expect(flat[0].content).toBe('desc a\n\nmore a')
    expect(flat[0].siteName).toBe('Site A')
    expect(flat[1].content).toContain('[Forum: r/rust, 3 answers]')
    expect(flat[1].content).toContain('how?')
  })

  it('returns [] for a null response', () => {
    expect(webResultsToSources(null)).toEqual([])
  })
})

describe('pickAgeLabel', () => {
  it('prefers a relative label', () => {
    expect(
      pickAgeLabel(['Thursday, June 18, 2026', '2026-06-18', '5 days ago'])
    ).toBe('5 days ago')
  })

  it('falls back to the ISO date when no relative label', () => {
    expect(pickAgeLabel(['Monday, October 23, 2023', '2023-10-23'])).toBe(
      '2023-10-23'
    )
  })

  it('returns undefined for empty/missing input', () => {
    expect(pickAgeLabel([])).toBeUndefined()
    expect(pickAgeLabel(undefined)).toBeUndefined()
  })
})

describe('imageResultsToMedia', () => {
  it('takes the largest rendition of a picture once', () => {
    const media = imageResultsToMedia({
      results: [
        {
          title: 'Shot',
          url: 'https://news.example/story',
          source: 'news.example',
          thumbnail: { src: 'https://imgs.brave.com/t1' },
          properties: {
            url: 'https://cdn.example/photo-1140x815.jpg',
            width: 1140,
            height: 815
          }
        },
        {
          title: 'Shot small',
          url: 'https://news.example/story/',
          properties: { url: 'https://cdn.example/photo-120x86.jpg' }
        },
        { title: 'No page', properties: { url: 'https://cdn.example/x.jpg' } }
      ]
    })

    expect(media).toEqual([
      {
        kind: 'image',
        title: 'Shot',
        url: 'https://cdn.example/photo-1140x815.jpg',
        sourceUrl: 'https://news.example/story',
        thumbnailUrl: 'https://imgs.brave.com/t1',
        source: 'news.example',
        width: 1140,
        height: 815
      }
    ])
  })

  it('leaves out what the filter refuses', () => {
    const media = imageResultsToMedia(
      {
        results: [
          {
            url: 'https://blocked.example/a',
            properties: { url: 'https://cdn.example/a.jpg' }
          }
        ]
      },
      (url) => !url.includes('blocked')
    )

    expect(media).toEqual([])
  })
})

describe('videoResultsToMedia', () => {
  it('reads creator, views and publisher from the nested video', () => {
    const [video] = videoResultsToMedia({
      results: [
        {
          title: 'How to',
          url: 'https://www.youtube.com/watch?v=1',
          meta_url: { hostname: 'www.youtube.com' },
          video: {
            duration: '04:12',
            creator: 'Chan',
            views: 1200,
            publisher: 'YouTube'
          }
        },
        { title: 'dup', url: 'https://www.youtube.com/watch?v=1' }
      ]
    })

    expect(video).toMatchObject({
      kind: 'video',
      source: 'www.youtube.com',
      duration: '04:12',
      creator: 'Chan',
      views: 1200,
      publisher: 'YouTube'
    })
  })
})

describe('newsArticles', () => {
  const now = Date.parse('2026-10-28T12:00:00Z')

  it('dates an article by page_age, else by its relative age', () => {
    const articles = newsArticles(
      {
        results: [
          {
            title: 'A - Reuters',
            url: 'https://reuters.com/a',
            profile: { name: 'Reuters' },
            page_age: '2026-10-28T10:00:00'
          },
          { title: 'B', url: 'https://b.example/b', age: '3 hours ago' },
          { title: 'C', url: 'https://c.example/c' },
          { url: 'https://no-title.example' }
        ]
      },
      now
    )

    expect(articles.map((a) => [a.title, a.source, a.publishedMs])).toEqual([
      ['A', 'Reuters', Date.parse('2026-10-28T10:00:00Z')],
      ['B', 'b.example', now - 3 * 3_600_000],
      ['C', 'c.example', 0]
    ])
    expect(articles[0].publishedAt).toBe('2026-10-28T10:00:00Z')
  })
})

describe('plainTitle', () => {
  it('prints a title as text', () => {
    expect(plainTitle('Press<br>release &amp; <strong>notes</strong>')).toBe(
      'Press release & notes'
    )
  })
})
