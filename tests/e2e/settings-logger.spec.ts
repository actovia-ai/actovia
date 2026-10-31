import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'

test.describe('Settings — Logger', () => {
  test('searches, charts and opens a line, and pivots to its trace', async ({
    mainWindow
  }) => {
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
    await mainWindow.keyboard.press(`${modKey}+,`)
    await mainWindow
      .getByRole('button', { name: 'Logger', exact: true })
      .click()

    await expect(
      mainWindow.getByTestId(TEST_IDS.logger.scopeSelect)
    ).toBeVisible()
    await expect(
      mainWindow.getByTestId(TEST_IDS.logger.liveToggle)
    ).toBeVisible()

    // The server logs "Hono is running" (scope: server) at startup, so there
    // is at least one row, and a bar in the chart for it.
    const rows = mainWindow.getByTestId(TEST_IDS.logger.row)
    await expect(rows.first()).toBeVisible()
    await expect(mainWindow.getByTestId(TEST_IDS.logger.chart)).toBeVisible()

    // A bar is a time window; its chip takes it off again.
    await mainWindow.getByTestId(TEST_IDS.logger.chartBar).first().click()
    await expect(
      mainWindow.getByTestId(TEST_IDS.logger.windowChip)
    ).toBeVisible()
    await mainWindow.getByTestId(TEST_IDS.logger.windowChip).click()
    await expect(
      mainWindow.getByTestId(TEST_IDS.logger.windowChip)
    ).toHaveCount(0)

    // The legend is the level filter: switching info off and on again.
    const info = mainWindow.locator(
      `[data-testid="${TEST_IDS.logger.levelToggle}"][data-level="info"]`
    )
    await info.click()
    await expect(info).toHaveAttribute('aria-pressed', 'false')
    await info.click()
    await expect(info).toHaveAttribute('aria-pressed', 'true')

    // `/` focuses the search; a word no line holds empties the list.
    const search = mainWindow.getByTestId(TEST_IDS.logger.searchInput)
    await mainWindow.keyboard.press('/')
    await expect(search).toBeFocused()
    await search.fill('zz-no-such-line-zz')
    await expect(rows).toHaveCount(0)
    await search.fill('')
    await expect(rows.first()).toBeVisible()

    // A line opens in the sheet; the arrows walk the list.
    await rows.first().click()
    const sheet = mainWindow.getByTestId(TEST_IDS.logger.detailSheet)
    await expect(sheet).toBeVisible()
    await expect(
      mainWindow.getByTestId(TEST_IDS.logger.detailPrev)
    ).toBeDisabled()
    if ((await rows.count()) > 1) {
      await mainWindow.getByTestId(TEST_IDS.logger.detailNext).click()
      await expect(
        mainWindow.getByTestId(TEST_IDS.logger.detailPrev)
      ).toBeEnabled()
    }
    await expect(
      mainWindow.getByTestId(TEST_IDS.logger.copyForAi)
    ).toBeVisible()
    await mainWindow.getByTestId(TEST_IDS.logger.copyForAi).click()
    await expect(
      mainWindow.getByTestId(TEST_IDS.logger.copyForAi)
    ).toContainText('Copied')

    // "Lines around" keeps the sheet on the line, inside a window.
    await mainWindow.getByTestId(TEST_IDS.logger.linesAround).click()
    await expect(
      mainWindow.getByTestId(TEST_IDS.logger.windowChip)
    ).toBeVisible()
    await expect(sheet).toBeVisible()

    // Same trace is enabled only for a traced line; find one if there is.
    const sameTrace = mainWindow.getByTestId(TEST_IDS.logger.traceBadge)
    if (await sameTrace.isEnabled()) {
      await sameTrace.click()
      await expect(sheet).toHaveCount(0)
      await expect(
        mainWindow.getByTestId(TEST_IDS.logger.traceFilterChip)
      ).toBeVisible()
      await mainWindow.getByTestId(TEST_IDS.logger.traceFilterChip).click()
      await expect(
        mainWindow.getByTestId(TEST_IDS.logger.traceFilterChip)
      ).toHaveCount(0)
    }
  })
})
