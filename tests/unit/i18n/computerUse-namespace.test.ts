import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const computerUse = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'packages',
      'shared',
      'src',
      'i18n',
      'locales',
      'en',
      'computerUse.json'
    ),
    'utf8'
  )
)

describe('computerUse namespace (en)', () => {
  it('has the alert text', () => {
    expect(computerUse.alert).toContain('agent-desktop')
    expect(computerUse.alert).toContain('agent-browser')
  })

  it('has the enable toggle keys', () => {
    expect(computerUse.enable).toMatchObject({
      label: 'Enable Computer Use',
      description: 'Let the AI drive an allowlisted window.'
    })
  })

  it('has the allowlist keys', () => {
    expect(computerUse.allowlist).toMatchObject({
      label: 'Allowlisted apps',
      searchPlaceholder: 'Search running apps…',
      loading: 'Loading apps…',
      noAppFound: 'No app found.'
    })
  })

  it('has the maxSteps and settleDelay keys', () => {
    expect(computerUse.maxSteps).toMatchObject({
      label: 'Max steps',
      description:
        'Maximum desktop observations and actions per agent run. Default 25.'
    })
    expect(computerUse.settleDelay).toMatchObject({
      label: 'Settle delay (ms)',
      description:
        'Wait this long after each action before the next screenshot. Default 800.'
    })
  })
})
