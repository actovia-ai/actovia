import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'

/**
 * Settings → Skills Market against the real skills.sh relay. The registry
 * is fetched by the main process, so the renderer cannot stub it: when no
 * card shows up within the timeout the spec skips rather than fails.
 * Installs land in the scratch HOME's ~/.actovia/skills (the fixture wipes it).
 */
test.describe('Settings — Skills Market', () => {
  test('browses, opens a detail page, installs and uninstalls a skill', async ({
    mainWindow
  }) => {
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
    await mainWindow.keyboard.press(`${modKey}+,`)
    await mainWindow
      .getByRole('button', { name: 'Skills Market', exact: true })
      .click()

    await expect(
      mainWindow.getByTestId(TEST_IDS.skillsMarket.searchInput)
    ).toBeVisible()
    await expect(
      mainWindow.getByTestId(TEST_IDS.skillsMarket.viewToggle)
    ).toBeVisible()
    await expect(
      mainWindow.getByTestId(TEST_IDS.skillsMarket.discoverTab)
    ).toBeVisible()
    await expect(
      mainWindow.getByTestId(TEST_IDS.skillsMarket.installedTab)
    ).toBeVisible()

    const firstRow = mainWindow.getByTestId(TEST_IDS.skillsMarket.row).first()
    const reachable = await firstRow
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false)
    test.skip(!reachable, 'skills.sh relay unreachable from this machine')

    await expect(
      mainWindow.getByTestId(TEST_IDS.skillsMarket.loadMoreButton)
    ).toBeVisible()

    // Same-repo rows collapse behind a "+N more" toggle when a repo repeats.
    const expand = mainWindow
      .getByTestId(TEST_IDS.skillsMarket.expandGroupButton)
      .first()
    if ((await expand.count()) > 0) {
      await expand.click()
      await expect(expand).toBeVisible()
    }

    // Curated: publishers, each opening to its skills.
    await mainWindow
      .getByTestId(TEST_IDS.skillsMarket.viewToggle)
      .getByRole('tab', { name: 'Curated' })
      .click()
    const owner = mainWindow
      .getByTestId(TEST_IDS.skillsMarket.curatedOwnerButton)
      .first()
    await expect(owner).toBeVisible({ timeout: 30_000 })
    await owner.click()
    await expect(firstRow).toBeVisible()
    await mainWindow
      .getByTestId(TEST_IDS.skillsMarket.viewToggle)
      .getByRole('tab', { name: /All time/ })
      .click()

    // Search narrows the list to results.
    await mainWindow
      .getByTestId(TEST_IDS.skillsMarket.searchInput)
      .fill('find-skills')
    await expect(firstRow).toBeVisible({ timeout: 20_000 })

    // Detail page: audit, CLI command, install.
    await firstRow.click()
    await expect(
      mainWindow.getByTestId(TEST_IDS.skillsMarket.backButton)
    ).toBeVisible()
    await expect(
      mainWindow.getByTestId(TEST_IDS.skillsMarket.auditPanel)
    ).toBeVisible()
    await expect(
      mainWindow.getByTestId(TEST_IDS.skillsMarket.cliCommand)
    ).toContainText('actovia skills install ')
    await expect(
      mainWindow.getByTestId(TEST_IDS.skillsMarket.copyCommandButton)
    ).toBeVisible()

    const install = mainWindow.getByTestId(TEST_IDS.skillsMarket.installButton)
    await expect(install).toBeEnabled({ timeout: 20_000 })
    await install.click()
    await expect(
      mainWindow.getByTestId(TEST_IDS.skillsMarket.activeSwitch)
    ).toBeVisible({
      timeout: 20_000
    })
    await expect(
      mainWindow.getByTestId(TEST_IDS.skillsMarket.uninstallButton)
    ).toBeVisible()

    // Back to the list: the Installed tab shows the row, and uninstall
    // (through the confirm dialog) empties it again.
    await mainWindow.getByTestId(TEST_IDS.skillsMarket.backButton).click()
    await mainWindow.getByTestId(TEST_IDS.skillsMarket.installedTab).click()
    await expect(
      mainWindow.getByTestId(TEST_IDS.skillsMarket.activeSwitch)
    ).toBeVisible()
    await mainWindow.getByTestId(TEST_IDS.skillsMarket.uninstallButton).click()
    await mainWindow
      .getByTestId(TEST_IDS.skillsMarket.confirmUninstallButton)
      .click()
    await expect(
      mainWindow.getByTestId(TEST_IDS.skillsMarket.uninstallButton)
    ).toHaveCount(0)
  })
})
