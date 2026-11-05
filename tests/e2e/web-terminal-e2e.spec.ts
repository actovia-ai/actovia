import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'
import { openSettings } from '../helpers/open-settings'

// The fixture owns a scratch HOME and refuses to run against an existing app.
// The browser is a separate Chromium context, never Electron's trusted window.
test.use({ channel: 'chrome' })
test('the production bundles pair a browser as a separate device and revokes it from Devices', async ({
  mainWindow,
  browser
}) => {
  await openSettings(mainWindow, 'Devices')
  await mainWindow
    .getByTestId(TEST_IDS.webAccess.origin)
    .fill('http://localhost:63130')
  await mainWindow.getByTestId(TEST_IDS.webAccess.enabled).check()
  await mainWindow.getByTestId(TEST_IDS.webAccess.save).click()
  await mainWindow.getByTestId(TEST_IDS.webAccess.pair).click()
  const code = await mainWindow
    .getByTestId(TEST_IDS.webAccess.pairingCode)
    .textContent()
  expect(code).toBeTruthy()

  const context = await browser.newContext()
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true
    }
  })
  await page.goto('http://localhost:63130')
  await page.getByTestId(TEST_IDS.webTerminal.name).fill('Paired Chrome')
  await page.getByTestId(TEST_IDS.webTerminal.code).fill(code!)
  await page.getByTestId(TEST_IDS.webTerminal.connect).click()
  await expect(page.getByTestId(TEST_IDS.composer.textarea)).toBeVisible()
  // Native Devices refreshes once its browser invitation has been consumed.
  await expect(mainWindow.getByTestId(TEST_IDS.devices.deviceRow)).toHaveCount(
    1
  )
  await expect(
    mainWindow.getByTestId(TEST_IDS.devices.deviceRow)
  ).toContainText('Paired Chrome')
  const created = await page.request.post(
    'http://localhost:63130/api/v1/philharmonic/conversations',
    {
      headers: { Origin: 'http://localhost:63130', 'x-actovia-web': '1' },
      data: { title: 'Browser group', icon: '💬' }
    }
  )
  expect(created.status()).toBe(201)
  const group = await created.json()
  await page.goto(`http://localhost:63130/#/philharmonic/groups/${group.id}`)
  await expect(
    page.getByTestId(TEST_IDS.philharmonicControls.input)
  ).toBeVisible()
  await expect(
    page.getByText('Browser group', { exact: true }).first()
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto('http://localhost:63130/#/library')
  await expect(page.getByTestId(TEST_IDS.library.page)).toBeVisible()
  await page.goto('http://localhost:63130/#/scheduled')
  await expect(
    page.getByRole('heading', { name: 'Scheduled', exact: true })
  ).toBeVisible()
  await page.goto('http://localhost:63130')
  await page.reload()
  await expect(page.getByTestId(TEST_IDS.composer.textarea)).toBeVisible()
  await expect(mainWindow.getByTestId(TEST_IDS.devices.deviceRow)).toHaveCount(
    1
  )
  const cookies = await context.cookies()
  expect(
    cookies.filter((cookie) => cookie.name.startsWith('__Host-actovia-'))
  ).toHaveLength(2)
  for (const cookie of cookies) {
    expect(cookie.httpOnly).toBe(true)
    expect(cookie.secure).toBe(true)
    expect(cookie.sameSite).toBe('Strict')
  }

  await mainWindow.getByTestId(TEST_IDS.devices.revokeButton).click()
  await mainWindow
    .getByRole('alertdialog')
    .getByRole('button', { name: /Revoke/iu })
    .click()
  await expect(mainWindow.getByTestId(TEST_IDS.devices.deviceRow)).toHaveCount(
    0
  )
  await page.reload()
  await expect(page.getByTestId(TEST_IDS.webTerminal.name)).toBeVisible()
  expect(
    (await page.request.get('http://localhost:63130/api/v1/history')).status()
  ).toBe(401)
  await mainWindow.getByTestId(TEST_IDS.webAccess.enabled).uncheck()
  await mainWindow.getByTestId(TEST_IDS.webAccess.save).click()
  await expect(mainWindow.getByTestId(TEST_IDS.webAccess.pair)).toBeDisabled()
  await context.close()
  expect(errors).toEqual([])
})
