/**
 * E2E: Settings page interaction.
 */
import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'
import { openSettings } from '../helpers/open-settings'

test.describe('Settings E2E', () => {
  test('About header shows a Dev badge only in development builds', async ({
    mainWindow
  }) => {
    await mainWindow.evaluate(() => {
      location.hash = '#/settings'
    })
    await mainWindow.getByRole('button', { name: 'About', exact: true }).click()
    await expect(
      mainWindow.getByRole('heading', { name: 'Actovia', exact: true })
    ).toBeVisible()
    const developmentBuild = process.env.ACTOVIA_EXPECT_DEV_BADGE === '1'
    await expect(mainWindow.getByText('Dev', { exact: true })).toHaveCount(
      developmentBuild ? 1 : 0
    )
    await mainWindow.screenshot({
      animations: 'disabled',
      path: `/tmp/actovia-about-${developmentBuild ? 'dev' : 'production'}.png`
    })
    await mainWindow.evaluate(() =>
      document.documentElement.classList.add('dark')
    )
    await mainWindow.screenshot({
      animations: 'disabled',
      path: `/tmp/actovia-about-${developmentBuild ? 'dev' : 'production'}-dark.png`
    })
  })
  test('settings page renders and shows provider options', async ({
    mainWindow
  }) => {
    await openSettings(mainWindow)

    // Settings page should contain provider-related text
    const bodyText = await mainWindow.textContent('body')
    const hasProviderContent =
      bodyText?.includes('OpenAI') ||
      bodyText?.includes('Claude') ||
      bodyText?.includes('Provider') ||
      bodyText?.includes('API Key')

    expect(hasProviderContent).toBe(true)
  })

  test('theme mode switcher changes the active mode', async ({
    mainWindow
  }) => {
    await openSettings(mainWindow)

    const dark = mainWindow.getByTestId(`${TEST_IDS.settings.themeMode}-dark`)
    const light = mainWindow.getByTestId(`${TEST_IDS.settings.themeMode}-light`)
    await dark.waitFor({ state: 'visible', timeout: 10_000 })

    await dark.click()
    await expect
      .poll(() => mainWindow.evaluate(() => document.documentElement.className))
      .toContain('dark')

    await light.click()
    await expect
      .poll(() => mainWindow.evaluate(() => document.documentElement.className))
      .not.toContain('dark')
  })

  test('colour tone picker paints data-tone and persists it', async ({
    mainWindow
  }) => {
    await openSettings(mainWindow)

    const emerald = mainWindow.getByTestId(
      `${TEST_IDS.settings.colorTone}-emerald`
    )
    await emerald.waitFor({ state: 'visible', timeout: 10_000 })
    await emerald.click()
    await expect
      .poll(() =>
        mainWindow.evaluate(() => document.documentElement.dataset.tone)
      )
      .toBe('emerald')

    // Persisted through the autosave, not merely applied.
    await expect
      .poll(() =>
        mainWindow.evaluate(async () => {
          const res = await fetch('http://localhost:60223/api/v1/settings')
          const s = await res.json()
          return s?.colorTone ?? null
        })
      )
      .toBe('emerald')

    await mainWindow
      .getByTestId(`${TEST_IDS.settings.colorTone}-neutral`)
      .click()
    await expect
      .poll(() =>
        mainWindow.evaluate(() => document.documentElement.dataset.tone)
      )
      .toBe('neutral')
  })

  test('reduced motion persists, stops movement, and follows the OS when off', async ({
    mainWindow
  }) => {
    await openSettings(mainWindow)
    const toggle = mainWindow.getByTestId(TEST_IDS.settings.reduceMotion)
    await expect(toggle).toHaveAccessibleName('Reduce motion')
    await toggle.click()
    await expect
      .poll(() =>
        mainWindow.evaluate(() => document.documentElement.dataset.reduceMotion)
      )
      .toBe('true')
    await expect
      .poll(() =>
        mainWindow.evaluate(
          async () =>
            (
              await (
                await fetch('http://localhost:60223/api/v1/settings')
              ).json()
            ).reduceMotion
        )
      )
      .toBe(true)
    await mainWindow.reload()
    await expect(toggle).toBeChecked()
    await mainWindow.emulateMedia({ reducedMotion: 'reduce' })
    await toggle.click()
    await expect
      .poll(() =>
        mainWindow.evaluate(() => document.documentElement.dataset.reduceMotion)
      )
      .toBe('false')
    expect(
      await mainWindow.evaluate(
        () => matchMedia('(prefers-reduced-motion: reduce)').matches
      )
    ).toBe(true)
  })

  test('language selector switches the app language live', async ({
    mainWindow
  }) => {
    await openSettings(mainWindow)

    const select = mainWindow.getByTestId(TEST_IDS.settings.languageSelect)
    await select.waitFor({ state: 'visible', timeout: 10_000 })

    await select.click()
    await mainWindow.getByRole('option', { name: 'Deutsch' }).click()

    await expect
      .poll(() => mainWindow.evaluate(() => document.documentElement.lang))
      .toBe('de')
  })

  test('switching back to Auto Detect re-resolves the OS language, not the previous explicit choice', async ({
    mainWindow
  }) => {
    // Regression: switching to an explicit locale, then back to "Auto
    // Detect" in the same session used to silently stay on the explicit
    // locale — LocaleBridge was reading a boot-time snapshot
    // (`window.api.locale`) instead of asking the main process to
    // re-resolve `'auto'` against the OS's current preferred languages.
    // CI runs with an English OS locale, so a correct re-resolution lands
    // back on `en`; a regression would stay on `de`.
    await openSettings(mainWindow)

    const select = mainWindow.getByTestId(TEST_IDS.settings.languageSelect)
    await select.waitFor({ state: 'visible', timeout: 10_000 })

    await select.click()
    await mainWindow.getByRole('option', { name: 'Deutsch' }).click()
    await expect
      .poll(() => mainWindow.evaluate(() => document.documentElement.lang))
      .toBe('de')

    await select.click()
    await mainWindow.getByRole('option', { name: /Auto/i }).click()

    await expect
      .poll(() => mainWindow.evaluate(() => document.documentElement.lang))
      .toBe('en')
  })
})
