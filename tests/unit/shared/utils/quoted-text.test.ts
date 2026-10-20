// "Ask about this": a piece of an answer the user selected travels with
// their next message as a markdown quote. actovia-ios holds the same three
// functions to the same vectors.
import {
  composeQuoted,
  QUOTE_MAX_LENGTH,
  quoteBlock,
  splitQuoted
} from '@actovia/shared/utils/quoted-text'
import { describe, expect, it } from 'vitest'

describe('quoteBlock', () => {
  it('writes the selection as a markdown quote', () => {
    expect(quoteBlock('大金（6367）已经卖出，不再算持仓。')).toBe(
      '> 大金（6367）已经卖出，不再算持仓。'
    )
  })

  it('quotes every line, and trims what a selection drags along', () => {
    expect(quoteBlock('  a \n\nb\r\n')).toBe('> a\n>\n> b')
  })

  it('cuts a very long selection', () => {
    const block = quoteBlock('x'.repeat(QUOTE_MAX_LENGTH + 50))

    expect(block).toBe(`> ${'x'.repeat(QUOTE_MAX_LENGTH)}…`)
  })
})

describe('composeQuoted', () => {
  it('is the quote, a blank line, and what was typed', () => {
    expect(composeQuoted('q', '  why?  ')).toBe('> q\n\nwhy?')
  })
})

describe('splitQuoted', () => {
  it.each([
    ['> q\n\nwhy?', 'q', 'why?'],
    ['> a\n> b\n>\n> c\n\nwhy?', 'a\nb\n\nc', 'why?'],
    ['>q\n\nwhy?', 'q', 'why?'],
    ['> q\nwhy?', 'q', 'why?'],
    ['> only a quote', 'only a quote', '']
  ])('reads %j as a quote and a question', (text, quote, body) => {
    expect(splitQuoted(text)).toEqual({ quote, body })
  })

  it('leaves a message that quotes nothing as it is', () => {
    expect(splitQuoted('why > not')).toEqual({ quote: null, body: 'why > not' })
    expect(splitQuoted('')).toEqual({ quote: null, body: '' })
  })

  it('gives back what composeQuoted was given', () => {
    expect(splitQuoted(composeQuoted('a\n\nb', 'why?'))).toEqual({
      quote: 'a\n\nb',
      body: 'why?'
    })
  })
})
