import { readFileSync } from 'fs'
import { join } from 'path'

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

for (const locale of LOCALE_IDS) {
  if (locale === 'en') {
    console.log(`en           source (canonical)`)
    continue
  }
  const s = JSON.parse(readFileSync(join(ROOT, locale, '_status.json'), 'utf8'))
  const reviewed = (s.reviewedNamespaces ?? []).length
  console.log(
    `${locale.padEnd(12)} ${String(s.source).padEnd(8)} reviewed ${reviewed}/${NAMESPACES.length}`
  )
}
