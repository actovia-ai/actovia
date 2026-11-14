import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { test, expect, type Page, type BrowserContext } from '@playwright/test'

async function authenticator(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true
      }
    }
  )
  return { cdp, authenticatorId }
}
async function pair(page: Page, name: string) {
  const { code } = await (await page.request.post('/__test/pair')).json()
  await page.goto('/')
  await page.getByTestId(TEST_IDS.webTerminal.name).fill(name)
  await page.getByTestId(TEST_IDS.webTerminal.code).fill(code)
  await page.getByTestId(TEST_IDS.webTerminal.connect).click()
  await expect(page.getByTestId(TEST_IDS.webTerminal.gate)).toHaveCount(0)
  await expect(page.getByTestId(TEST_IDS.composer.textarea)).toBeVisible()
}

test.beforeEach(async ({ request }) => {
  await request.post('/__test/reset')
})

test('pairing adds an independent device; reload and passkey unlock keep the same device', async ({
  page,
  context,
  browser
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /Content Security Policy|Executing inline script|window.electron/u.test(
        message.text()
      )
    )
      errors.push(message.text())
  })
  await authenticator(context, page)
  await pair(page, 'Work Chrome')
  const first = await (await page.request.get('/__test/state')).json()
  expect(first).toHaveLength(1)
  await page.reload()
  await expect(page.getByTestId(TEST_IDS.composer.textarea)).toBeVisible()
  await page.goto('/#/settings?tab=devices')
  await page.getByTestId(TEST_IDS.webTerminal.lock).click()
  await expect(page.getByTestId(TEST_IDS.webTerminal.gate)).toBeVisible()
  await expect(page.getByTestId(TEST_IDS.webTerminal.name)).toHaveCount(0)
  await expect(page.getByTestId(TEST_IDS.webTerminal.forget)).toBeVisible()
  await page.getByTestId(TEST_IDS.webTerminal.connect).click()
  await expect(page.getByTestId(TEST_IDS.webTerminal.gate)).toHaveCount(0)
  expect(await (await page.request.get('/__test/state')).json()).toEqual(first)

  const other = await browser.newContext({ baseURL: 'http://localhost:63131' })
  const second = await other.newPage()
  await authenticator(other, second)
  await pair(second, 'Personal browser')
  expect(await (await page.request.get('/__test/state')).json()).toHaveLength(2)
  await page.request.post(`/__test/revoke/${first[0].id}`)
  await page.reload()
  await expect(page.getByTestId(TEST_IDS.webTerminal.name)).toBeVisible()
  expect((await second.request.get('/api/v1/settings')).status()).toBe(200)
  await other.close()
  expect(errors).toEqual([])
})

test('idle expiry and host lock require verification, without registering another device', async ({
  page,
  context
}) => {
  await authenticator(context, page)
  await pair(page, 'Test browser')
  await page.request.post('/__test/expire')
  await page.reload()
  await expect(page.getByTestId(TEST_IDS.webTerminal.gate)).toBeVisible()
  await page.getByTestId(TEST_IDS.webTerminal.connect).click()
  await expect(page.getByTestId(TEST_IDS.webTerminal.gate)).toHaveCount(0)
  await page.request.post('/__test/lock')
  await page.reload()
  await expect(page.getByTestId(TEST_IDS.webTerminal.gate)).toBeVisible()
  await page.getByTestId(TEST_IDS.webTerminal.connect).click()
  await expect(page.getByTestId(TEST_IDS.composer.textarea)).toBeVisible()
  expect(await (await page.request.get('/__test/state')).json()).toHaveLength(1)
  await page.goto('/#/settings?tab=devices')
  await page
    .getByRole('button', { name: 'Forget this browser', exact: true })
    .click()
  await expect(page.getByTestId(TEST_IDS.webTerminal.name)).toBeVisible()
  expect(await (await page.request.get('/__test/state')).json()).toHaveLength(0)
})

test('failed pairing stays on the gate and preserves a useful retry path', async ({
  page,
  context
}) => {
  await authenticator(context, page)
  await page.goto('/')
  await page.getByTestId(TEST_IDS.webTerminal.name).fill('Test')
  await page.getByTestId(TEST_IDS.webTerminal.code).fill('wrong')
  await page.getByTestId(TEST_IDS.webTerminal.connect).click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect(await (await page.request.get('/__test/state')).json()).toHaveLength(0)
  await page.route('**/api/web-terminal', (route) => route.abort())
  await page.reload()
  await expect(page.getByTestId(TEST_IDS.webTerminal.retry)).toBeVisible()
})

test('desktop setup controls save the address and open or cancel a one-time invitation', async ({
  page,
  context
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/__test/settings')
  const enabled = page.getByTestId(TEST_IDS.webAccess.enabled)
  await expect(enabled).toBeEnabled()
  await enabled.click()
  await page
    .getByTestId(TEST_IDS.webAccess.origin)
    .fill('https://mac.example.ts.net')
  await page.getByTestId(TEST_IDS.webAccess.save).click()
  await page.getByTestId(TEST_IDS.webAccess.pair).click()
  await expect(page.getByTestId(TEST_IDS.webAccess.pairingCode)).toBeVisible()
  await page.getByTestId(TEST_IDS.webAccess.copyCode).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    await page.getByTestId(TEST_IDS.webAccess.pairingCode).textContent()
  )
  await page.getByTestId(TEST_IDS.webAccess.cancelPairing).click()
  await expect(page.getByTestId(TEST_IDS.webAccess.pairingCode)).toHaveCount(0)
})

test('web Artifact renders and responds to input inside an isolated sandbox', async ({
  page,
  context
}) => {
  await authenticator(context, page)
  await pair(page, 'Artifact browser')
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  page.on('response', (response) => {
    if (
      response.url().includes('/artifacts/sandbox/') &&
      response.status() >= 400
    )
      failures.push(`${response.status()} ${response.url()}`)
  })
  await page.goto('/__test/settings?artifact')
  const frame = page.frameLocator('iframe')
  await expect(
    frame.getByRole('heading', { name: 'Interactive artifact' })
  ).toBeVisible()
  await expect(frame.getByText('Parent isolated')).toBeVisible()
  await frame.getByRole('button', { name: 'Count 0' }).click()
  await expect(frame.getByRole('button', { name: 'Count 1' })).toBeVisible()
  expect(await page.locator('iframe').getAttribute('sandbox')).toBe(
    'allow-scripts'
  )
  const download = page.waitForEvent('download')
  await page.getByTestId(TEST_IDS.webTerminal.downloadSource).click()
  expect((await download).suggestedFilename()).toBe('untrusted-source.txt')
  expect(failures).toEqual([])
})

test('web Library thumbnail renders fetched artifact code', async ({
  page,
  context
}) => {
  await authenticator(context, page)
  await pair(page, 'Library browser')
  await page.goto('/__test/settings?library')
  await expect(page.getByTestId(TEST_IDS.library.preview)).toHaveAttribute(
    'data-state',
    'rendered'
  )
  await expect(
    page
      .frameLocator('iframe')
      .getByRole('heading', { name: 'Library preview rendered' })
  ).toBeVisible()
})

test('pairing and setup remain usable in narrow and dark browser windows', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByTestId(TEST_IDS.webTerminal.connect)).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await testInfo.attach('browser-pairing-narrow', {
    body: await page.screenshot({ path: testInfo.outputPath('pairing.png') }),
    contentType: 'image/png'
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/__test/settings')
  await expect(page.getByTestId(TEST_IDS.webAccess.origin)).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await testInfo.attach('browser-setup-narrow', {
    body: await page.screenshot({ path: testInfo.outputPath('settings.png') }),
    contentType: 'image/png'
  })
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`browser pairing gate shows the brand illustration in ${colorScheme} mode`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.emulateMedia({ colorScheme })
    await page.goto('/')
    const gate = page.getByTestId(TEST_IDS.webTerminal.gate)
    await expect(
      gate.getByRole('heading', { name: 'Connect to Actovia' })
    ).toBeVisible()
    const illustration = gate.locator('[aria-hidden="true"] img')
    await expect(illustration).toBeVisible()
    expect(
      await illustration.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0
      )
    ).toBe(true)
    const palette = () =>
      gate.evaluate((element) => {
        const style = getComputedStyle(element)
        const button = getComputedStyle(element.querySelector('button')!)
        return [
          style.backgroundColor,
          style.color,
          style.getPropertyValue('--ring'),
          button.backgroundColor,
          button.color
        ]
      })
    const neutral = await palette()
    for (const tone of [
      'emerald',
      'blue',
      'violet',
      'rose',
      'orange',
      'yellow'
    ]) {
      await page.evaluate((tone) => {
        document.documentElement.dataset.tone = tone
      }, tone)
      expect(await palette()).toEqual(neutral)
    }
    await testInfo.attach(`pairing-${colorScheme}`, {
      body: await page.screenshot({
        path: testInfo.outputPath('pairing-desktop.png')
      }),
      contentType: 'image/png'
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(illustration).toBeHidden()
    await expect(page.getByTestId(TEST_IDS.webTerminal.connect)).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
  })
}

test('workspace preview reads the chat-scoped HTTP API and offers no native Open action', async ({
  page,
  context
}) => {
  await authenticator(context, page)
  await pair(page, 'Workspace browser')
  const request = page.waitForRequest((request) =>
    request.url().includes('/api/v1/workspace/fixture-chat/file')
  )
  await page.goto('/__test/settings?workspace')
  await expect(
    page.getByTestId(TEST_IDS.chat.workspaceFile.preview)
  ).toBeVisible()
  await expect(page.getByText('A file from the chat workspace.')).toBeVisible()
  expect(new URL((await request).url()).searchParams.get('path')).toBe(
    'notes.md'
  )
  await expect(
    page.getByRole('button', { name: 'Open', exact: true })
  ).toHaveCount(0)
})
