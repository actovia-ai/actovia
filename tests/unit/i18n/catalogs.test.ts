import { readFileSync } from 'fs'
import { join } from 'path'

import {
  auditCatalogs,
  flattenCatalog
} from '@actovia/shared/i18n/catalog-audit'
import { LOCALE_IDS } from '@actovia/shared/i18n/locales'
import { NAMESPACES } from '@actovia/shared/i18n/namespaces'
import { describe, expect, it } from 'vitest'

const ROOT = join(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'shared',
  'src',
  'i18n',
  'locales'
)

function nsMap(locale: string) {
  const out: Record<string, Map<string, string>> = {}
  for (const ns of NAMESPACES) {
    const raw = readFileSync(join(ROOT, locale, `${ns}.json`), 'utf8')
    out[ns] = flattenCatalog(JSON.parse(raw))
  }
  return out
}

describe('flattenCatalog', () => {
  it('flattens nested objects to dot keys', () => {
    const m = flattenCatalog({ a: { b: 'x' }, c: 'y' })
    expect([...m.entries()]).toEqual([
      ['a.b', 'x'],
      ['c', 'y']
    ])
  })
})

describe('catalog audit (repo state)', () => {
  it('every locale has all 13 namespace files and they parse', () => {
    for (const locale of LOCALE_IDS) expect(() => nsMap(locale)).not.toThrow()
  })

  it('no locale has orphan keys or param mismatches', () => {
    const en = nsMap('en')
    const others: Record<
      string,
      { nsMap: ReturnType<typeof nsMap>; source: string }
    > = {}
    for (const locale of LOCALE_IDS) {
      if (locale === 'en') continue
      const status = JSON.parse(
        readFileSync(join(ROOT, locale, '_status.json'), 'utf8')
      )
      others[locale] = { nsMap: nsMap(locale), source: status.source }
    }
    const { ok, findings } = auditCatalogs({ en, others })
    const errors = findings.filter((f) => f.level === 'error')
    expect(errors, JSON.stringify(errors, null, 2)).toEqual([])
    expect(ok).toBe(true)
  })
})
