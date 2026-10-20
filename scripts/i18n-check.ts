import { readFileSync } from 'fs'
import { join } from 'path'

import {
  auditCatalogs,
  flattenCatalog,
  type NsMap
} from '@actovia/shared/i18n/catalog-audit'
import { LOCALE_IDS } from '@actovia/shared/i18n/locales'
import { NAMESPACES } from '@actovia/shared/i18n/namespaces'

const ROOT = join(
  __dirname,
  '..',
  'packages',
  'shared',
  'src',
  'i18n',
  'locales'
)

function nsMap(locale: string): NsMap {
  const out: NsMap = {}
  for (const ns of NAMESPACES) {
    out[ns] = flattenCatalog(
      JSON.parse(readFileSync(join(ROOT, locale, `${ns}.json`), 'utf8'))
    )
  }
  return out
}

const en = nsMap('en')
const others: Parameters<typeof auditCatalogs>[0]['others'] = {}
for (const locale of LOCALE_IDS) {
  if (locale === 'en') continue
  const status = JSON.parse(
    readFileSync(join(ROOT, locale, '_status.json'), 'utf8')
  )
  others[locale] = { nsMap: nsMap(locale), source: status.source }
}

const { ok, findings } = auditCatalogs({ en, others })
for (const f of findings) {
  console.log(`${f.level === 'error' ? '✗' : '·'} ${f.locale}: ${f.message}`)
}
console.log(ok ? '\ni18n:check OK' : '\ni18n:check FAILED')
process.exit(ok ? 0 : 1)
