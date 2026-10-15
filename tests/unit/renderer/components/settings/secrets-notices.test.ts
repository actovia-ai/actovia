// @vitest-environment happy-dom
import { TEST_IDS } from '@exodus/shared/constants/test-ids'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SecretsStatus } from '@/services/settings'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const state = vi.hoisted(() => ({
  status: undefined as SecretsStatus | undefined
}))
vi.mock('@/hooks/use-secrets-status', () => ({
  useSecretsStatus: () => ({ data: state.status })
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}${JSON.stringify(params)}` : key
  })
}))

const { SecretsNotices } =
  await import('@/components/settings/settings-form/secrets-notices')

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const render = () => act(() => root.render(createElement(SecretsNotices)))
const byTestId = (id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`)

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  state.status = undefined
})

describe('SecretsNotices', () => {
  it('shows nothing before the status has loaded, or when all is well', () => {
    render()
    expect(host.textContent).toBe('')
    state.status = { encryption: 'on', needsReentry: [] }
    render()
    expect(host.textContent).toBe('')
  })

  it('says so when the keychain is unavailable and keys are stored unencrypted', () => {
    state.status = { encryption: 'unavailable', needsReentry: [] }
    render()
    expect(byTestId(TEST_IDS.secrets.encryptionNotice)?.textContent).toBe(
      'secrets.notice.encryptionUnavailable'
    )
    expect(byTestId(TEST_IDS.secrets.reentryNotice)).toBeNull()
  })

  it('names every key that needs entering again, MCP servers included', () => {
    state.status = {
      encryption: 'on',
      needsReentry: [
        'providers.openaiApiKey',
        'knowledgeBase.apiKey',
        'mcp:github:env.GITHUB_TOKEN',
        'mcp:my:odd:name:url',
        'somethingNew.apiKey'
      ]
    }
    render()
    const notice = byTestId(TEST_IDS.secrets.reentryNotice)!
    expect(notice.textContent).toContain('secrets.notice.needsReentry')
    const items = [...notice.querySelectorAll('li')].map((li) => li.textContent)
    expect(items).toEqual([
      'secrets.fields.openaiApiKey',
      'secrets.fields.knowledgeBaseApiKey',
      'secrets.fields.mcp{"server":"github","field":"env.GITHUB_TOKEN"}',
      'secrets.fields.mcp{"server":"my:odd:name","field":"url"}',
      // A path this build has no name for still shows, as itself.
      'somethingNew.apiKey'
    ])
    expect(byTestId(TEST_IDS.secrets.encryptionNotice)).toBeNull()
  })
})
