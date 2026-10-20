// actovia-ios has the same splitter (`ThinkingTags`), held to these vectors.
import {
  splitThinkingTags,
  splitThinkingTagsInContent
} from '@actovia/shared/utils/thinking-tags'
import { describe, expect, it } from 'vitest'

const text = (t: string) => ({ type: 'text' as const, text: t })
const thinking = (t: string) => ({ type: 'thinking' as const, text: t })

describe('splitThinkingTags', () => {
  it('text without tags is one text part', () => {
    expect(splitThinkingTags('hello world')).toEqual([text('hello world')])
  })

  it('empty text is no parts', () => {
    expect(splitThinkingTags('')).toEqual([])
  })

  it('a leading <thinking> span becomes thinking, the rest text', () => {
    expect(
      splitThinkingTags(
        '<thinking>国庆假期，北京。用 map_itinerary 展示。</thinking>\n\n我来规划。'
      )
    ).toEqual([
      thinking('国庆假期，北京。用 map_itinerary 展示。'),
      text('我来规划。')
    ])
  })

  it('<think> works the same', () => {
    expect(splitThinkingTags('<think>\nplan\n</think>\nanswer')).toEqual([
      thinking('plan'),
      text('answer')
    ])
  })

  it('tag names are case-insensitive', () => {
    expect(splitThinkingTags('<THINKING>a</Thinking> b')).toEqual([
      thinking('a'),
      text('b')
    ])
  })

  it('a closing tag of the other name still closes', () => {
    expect(splitThinkingTags('<thinking>a</think>b')).toEqual([
      thinking('a'),
      text('b')
    ])
  })

  it('a span on its own line mid-text, and several spans', () => {
    expect(
      splitThinkingTags(
        'Intro.\n<think>one</think>\nMiddle.\n  <thinking>two</thinking>\nEnd.'
      )
    ).toEqual([
      text('Intro.'),
      thinking('one'),
      text('Middle.'),
      thinking('two'),
      text('End.')
    ])
  })

  it('adjacent spans join into one thinking part', () => {
    expect(splitThinkingTags('<think>a</think>\n<think>b</think>\nc')).toEqual([
      thinking('a\n\nb'),
      text('c')
    ])
  })

  it('a tag mentioned mid-sentence is prose, not a span', () => {
    const s = 'DeepSeek wraps reasoning in a <think> tag before answering.'
    expect(splitThinkingTags(s)).toEqual([text(s)])
  })

  it('a tag inside an inline code span is left alone', () => {
    const s = '`<thinking>` is the tag'
    expect(splitThinkingTags(s)).toEqual([text(s)])
  })

  it('a tag inside a fenced code block is left alone', () => {
    const s = 'Example:\n```xml\n<thinking>\nplan\n</thinking>\n```\nDone.'
    expect(splitThinkingTags(s)).toEqual([text(s)])
  })

  it('a tilde fence and a span after the fence closes', () => {
    const s = '~~~\n<think>x</think>\n~~~\n<think>real</think>\nok'
    expect(splitThinkingTags(s)).toEqual([
      text('~~~\n<think>x</think>\n~~~'),
      thinking('real'),
      text('ok')
    ])
  })

  it('a span whose content holds code fences ends at its tag', () => {
    expect(
      splitThinkingTags('<thinking>try\n```\ncode\n```\n</thinking>\nanswer')
    ).toEqual([thinking('try\n```\ncode\n```'), text('answer')])
  })

  it('other angle-bracket text is untouched', () => {
    const s = '<thinker>x</thinker> <div>y</div> a < b > c\n<thinkingcap>'
    expect(splitThinkingTags(s)).toEqual([text(s)])
  })

  it('a tag with attributes is not a span', () => {
    const s = '<think mode="x">a</think>'
    expect(splitThinkingTags(s)).toEqual([text(s)])
  })

  it('an unclosed span at the end is reasoning', () => {
    expect(splitThinkingTags('<thinking>still going')).toEqual([
      thinking('still going')
    ])
    expect(splitThinkingTags('Answer.\n<think>half')).toEqual([
      text('Answer.'),
      thinking('half')
    ])
  })

  it('an empty span vanishes', () => {
    expect(splitThinkingTags('<think></think>\nhi')).toEqual([text('hi')])
  })

  describe('streaming (final: false)', () => {
    it('holds back a partial opening tag at a line start', () => {
      expect(splitThinkingTags('<thi', false)).toEqual([])
      expect(splitThinkingTags('a\n<', false)).toEqual([text('a\n')])
      expect(splitThinkingTags('<THINK', false)).toEqual([])
    })

    it('flushes it as text once it is final', () => {
      expect(splitThinkingTags('<thi', true)).toEqual([text('<thi')])
    })

    it('does not hold back what cannot become a tag', () => {
      expect(splitThinkingTags('<thx', false)).toEqual([text('<thx')])
      expect(splitThinkingTags('a <thi', false)).toEqual([text('a <thi')])
    })

    it('holds back a partial closing tag inside a span', () => {
      expect(splitThinkingTags('<thinking>plan</thin', false)).toEqual([
        thinking('plan')
      ])
    })

    it('byte by byte, every prefix is consistent and the end is right', () => {
      const s =
        'Pre.\n<THINKING>国庆假期\n用 map_itinerary。</thinking>\n\n我来。\n```\n<think>code</think>\n```\n<think>b</think> tail'
      const expected = [
        text('Pre.'),
        thinking('国庆假期\n用 map_itinerary。'),
        text('我来。\n```\n<think>code</think>\n```'),
        thinking('b'),
        text('tail')
      ]
      for (let i = 0; i <= s.length; i++) {
        const parts = splitThinkingTags(s.slice(0, i), false)
        const shown = parts.map((p) => p.text).join('')
        // Nothing of a tag ever reaches the text on screen.
        for (const p of parts) {
          if (p.type === 'text' && !p.text.includes('```')) {
            expect(p.text).not.toMatch(/<\/?think/i)
          }
        }
        expect(typeof shown).toBe('string')
      }
      expect(splitThinkingTags(s, false)).toEqual(expected)
      expect(splitThinkingTags(s, true)).toEqual(expected)
    })

    it('every chunking of the screenshot answer ends the same', () => {
      const s =
        '<thinking>国庆假期，北京，避开热门景点。用 map_itinerary 展示。</thinking>\n\n好的，下面是行程。'
      const want = splitThinkingTags(s)
      for (let size = 1; size <= 7; size++) {
        let acc = ''
        let last = splitThinkingTags('', false)
        for (let i = 0; i < s.length; i += size) {
          acc += s.slice(i, i + size)
          last = splitThinkingTags(acc, false)
          const textParts = last.filter((p) => p.type === 'text')
          for (const p of textParts) expect(p.text).not.toContain('<')
        }
        expect(last).toEqual(want)
      }
      expect(want).toEqual([
        thinking('国庆假期，北京，避开热门景点。用 map_itinerary 展示。'),
        text('好的，下面是行程。')
      ])
    })
  })
})

describe('splitThinkingTagsInContent', () => {
  it('returns the same array when no block has a span', () => {
    const content = [
      { type: 'text' as const, text: 'hi' },
      { type: 'toolCall' as const, id: '1', name: 'x', arguments: {} }
    ]
    expect(splitThinkingTagsInContent(content)).toBe(content)
  })

  it('splits a text block into thinking and text blocks in place', () => {
    const call = {
      type: 'toolCall' as const,
      id: '1',
      name: 'map_itinerary',
      arguments: {}
    }
    const out = splitThinkingTagsInContent([
      {
        type: 'text' as const,
        text: '<thinking>plan</thinking>\nGo.',
        textSignature: 'sig'
      },
      call
    ])
    expect(out).toEqual([
      { type: 'thinking', thinking: 'plan' },
      { type: 'text', text: 'Go.', textSignature: 'sig' },
      call
    ])
  })

  it('a block that is only a span becomes one thinking block', () => {
    expect(
      splitThinkingTagsInContent([
        { type: 'text' as const, text: '<think>p</think>' }
      ])
    ).toEqual([{ type: 'thinking', thinking: 'p' }])
  })

  it('keeps a text signature on the first text part only', () => {
    expect(
      splitThinkingTagsInContent([
        {
          type: 'text' as const,
          text: 'a\n<think>p</think>\nb',
          textSignature: 's'
        }
      ])
    ).toEqual([
      { type: 'text', text: 'a', textSignature: 's' },
      { type: 'thinking', thinking: 'p' },
      { type: 'text', text: 'b' }
    ])
  })

  it('streaming: a held-back partial tag drops the block for now', () => {
    expect(
      splitThinkingTagsInContent(
        [{ type: 'text' as const, text: '<thin' }],
        false
      )
    ).toEqual([])
  })
})
