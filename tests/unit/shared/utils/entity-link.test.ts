// An `entity:` link names a Wikipedia article; anything a reply could write
// that is not one is plain text. actovia-ios's MarkdownLinkPolicyTests.entity
// holds the same vectors — keep them in step.
import {
  entityTitle,
  isWikipediaLang,
  isWikipediaTitle,
  wikipediaLang
} from '@actovia/shared/utils/entity-link'
import { describe, expect, it } from 'vitest'

const ENTITY_CASES: Array<[string, string, string | null]> = [
  ['a plain title', 'entity:Marie_Curie', 'Marie_Curie'],
  [
    'a title with punctuation Wikipedia uses',
    "entity:Dvořák's_Symphony_No._9_(From_the_New_World)",
    "Dvořák's_Symphony_No._9_(From_the_New_World)"
  ],
  ['a CJK title', 'entity:東京', '東京'],
  ['a percent-encoded title', 'entity:%E6%9D%B1%E4%BA%AC', '東京'],
  [
    'a colon inside (a namespace)',
    'entity:Category:Physicists',
    'Category:Physicists'
  ],
  ['a 200-unit title', 'entity:' + 'a'.repeat(200), 'a'.repeat(200)],
  ['a 201-unit title', 'entity:' + 'a'.repeat(201), null],
  [
    '100 emoji (200 units) are letters? no — not in the set',
    'entity:' + '😀'.repeat(100),
    null
  ],
  ['an empty title', 'entity:', null],
  ['a slash', 'entity:Marie/Curie', null],
  ['a dot-dot', 'entity:..', null],
  ['a single dot', 'entity:.', null],
  ['only punctuation', "entity:_()'", null],
  ['an encoded slash', 'entity:Marie%2FCurie', null],
  ['a bad percent escape', 'entity:%E6%9D', null],
  ['a query', 'entity:Marie_Curie?x=1', null],
  ['a hash', 'entity:Marie_Curie#History', null],
  ['a space', 'entity:Marie Curie', null],
  // `entity:javascript:alert(1)` IS a title by the alphabet (as `Category:Physicists` is) and harmless: a title
  // is only ever a percent-encoded path segment of the Wikipedia URL, never navigated — so it is not a vector.
  ['not an entity link', 'https://en.wikipedia.org/wiki/Marie_Curie', null],
  ['the scheme in capitals', 'ENTITY:Marie_Curie', null],
  ['nothing', '', null]
]

describe('entityTitle', () => {
  it.each(ENTITY_CASES)('%s → %s', (_name, href, title) => {
    expect(entityTitle(href)).toBe(title)
  })
  it('is null for no href', () => {
    expect(entityTitle(null)).toBeNull()
    expect(entityTitle()).toBeNull()
  })
  it('isWikipediaTitle is the same rule on a bare title', () => {
    expect(isWikipediaTitle('Marie_Curie')).toBe(true)
    expect(isWikipediaTitle('..')).toBe(false)
    expect(isWikipediaTitle('a/b')).toBe(false)
  })
})

describe('wikipediaLang', () => {
  it.each([
    ['en', 'en'],
    ['zh-Hans', 'zh'],
    ['zh-Hant-TW', 'zh'],
    ['zh-Hant-HK', 'zh'],
    ['pt-BR', 'pt'],
    ['ja', 'ja'],
    ['ko', 'ko'],
    ['DE', 'de'],
    ['', 'en'],
    ['x', 'en'],
    ['toolong-x', 'en']
  ])('%s → %s', (locale, lang) => {
    expect(wikipediaLang(locale)).toBe(lang)
  })
  it('isWikipediaLang accepts two or three lowercase letters', () => {
    expect(isWikipediaLang('en')).toBe(true)
    expect(isWikipediaLang('yue')).toBe(true)
    expect(isWikipediaLang('EN')).toBe(false)
    expect(isWikipediaLang('e')).toBe(false)
    expect(isWikipediaLang('en.wikipedia.org')).toBe(false)
  })
})
