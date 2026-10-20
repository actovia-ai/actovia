import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { on: vi.fn() },
  session: {},
  shell: { openExternal: vi.fn(async () => {}) }
}))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { shell } = await import('electron')
const { isAppUrl, isInAppNavigation, isSafeExternalUrl, openExternalSafely } =
  await import('@main/lib/security')

describe('isSafeExternalUrl', () => {
  it.each([
    'https://example.com/a?b=c',
    'http://example.com',
    'mailto:someone@example.com'
  ])('allows %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(true)
  })

  it.each([
    'file:///Applications/Calculator.app',
    'smb://attacker/share',
    'javascript:alert(1)',
    'vscode://file/etc/passwd',
    'ms-msdt:/id PCWDiagnostic',
    'data:text/html,<script>1</script>',
    'not a url',
    ''
  ])('refuses %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(false)
  })
})

describe('openExternalSafely', () => {
  it('hands a web link to the OS and nothing else', () => {
    openExternalSafely('file:///etc/passwd')
    expect(shell.openExternal).not.toHaveBeenCalled()

    openExternalSafely('https://example.com')
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com')
  })
})

describe('isInAppNavigation', () => {
  const DEV = 'http://localhost:5173/#/chat/1'
  const PACKAGED =
    'file:///Applications/Actovia.app/renderer/index.html#/chat/1'

  it('allows a reload in dev and when packaged', () => {
    expect(isInAppNavigation(DEV, 'http://localhost:5173/')).toBe(true)
    expect(
      isInAppNavigation(
        PACKAGED,
        'file:///Applications/Actovia.app/renderer/index.html'
      )
    ).toBe(true)
  })

  it('refuses to leave the app', () => {
    expect(isInAppNavigation(DEV, 'https://example.com')).toBe(false)
    expect(isInAppNavigation(DEV, 'http://localhost:60223/')).toBe(false)
    expect(isInAppNavigation(PACKAGED, 'https://example.com')).toBe(false)
    expect(isInAppNavigation(PACKAGED, 'file:///etc/passwd')).toBe(false)
    expect(isInAppNavigation(DEV, 'not a url')).toBe(false)
  })
})

describe('isAppUrl', () => {
  const DEV_SERVER = 'http://localhost:5173'

  it("recognises Actovia's own pages", () => {
    expect(
      isAppUrl('file:///Applications/Actovia.app/index.html', undefined)
    ).toBe(true)
    expect(isAppUrl('http://localhost:5173/#/settings', DEV_SERVER)).toBe(true)
  })

  it('does not extend that to embedded frames or an unknown requester', () => {
    expect(isAppUrl('https://embed.diagrams.net/', DEV_SERVER)).toBe(false)
    expect(isAppUrl('https://www.tradingview.com/', undefined)).toBe(false)
    expect(isAppUrl('http://localhost:5173/', undefined)).toBe(false)
    expect(isAppUrl(undefined, DEV_SERVER)).toBe(false)
    expect(isAppUrl('', DEV_SERVER)).toBe(false)
  })
})
