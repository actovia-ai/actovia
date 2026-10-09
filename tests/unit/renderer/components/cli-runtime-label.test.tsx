import { readFileSync } from 'fs'
import { join } from 'path'

import type { CliStatus } from '@exodus/shared/types/agents'
import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { describe, expect, it } from 'vitest'

import { CliRuntimeLabel } from '@/components/philharmonic/employees/cli-runtime-label'

const philharmonic = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../packages/shared/src/i18n/locales/en/philharmonic.json'
    ),
    'utf8'
  )
)

const cli = (state: CliStatus['state']): CliStatus => ({
  id: 'claude-code',
  state,
  path: null,
  version: null,
  authMethod: null,
  detail: null,
  checkedAt: 0
})

describe('CliRuntimeLabel', () => {
  const instance = i18n.createInstance()
  instance.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { philharmonic } },
    defaultNS: 'philharmonic'
  })
  const render = (state: CliStatus['state']) =>
    renderToStaticMarkup(
      <I18nextProvider i18n={instance}>
        <CliRuntimeLabel cli={cli(state)} />
      </I18nextProvider>
    )

  it('says in words why a CLI is not ready', () => {
    expect(render('not_installed')).toBe('Claude Code — Not installed')
    expect(render('logged_out')).toBe('Claude Code — Not logged in')
  })

  it('is just the name when ready', () => {
    expect(render('ready')).toBe('Claude Code')
  })
})
