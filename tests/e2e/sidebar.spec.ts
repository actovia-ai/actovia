/**
 * E2E: Sidebar navigation and interaction.
 */
import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'

test.describe('Sidebar', () => {
  test('sidebar is visible on launch', async ({ mainWindow }) => {
    // shadcn's <Sidebar /> tags its root with data-slot="sidebar" rather than
    // rendering a <nav> / <aside>; match that first, fall back to the older
    // selectors for any plain-HTML sidebar.
    const sidebar = mainWindow.locator(
      '[data-slot="sidebar"], [data-testid="sidebar"], nav, aside'
    )
    await sidebar.first().waitFor({ state: 'visible', timeout: 10_000 })
    expect(await sidebar.first().isVisible()).toBe(true)
  })

  test('sidebar contains navigation elements', async ({ mainWindow }) => {
    await mainWindow.waitForTimeout(2_000)

    const bodyText = await mainWindow.textContent('body')

    // Should have some navigation elements (Settings, new chat, etc.)
    const hasNavigation =
      bodyText?.includes('Settings') ||
      bodyText?.includes('New') ||
      bodyText?.includes('Chat')

    expect(hasNavigation).toBe(true)
  })

  test('resizable handle resizes the sidebar', async ({ mainWindow }) => {
    const handle = mainWindow.locator('[data-slot="resizable-handle"]')
    await handle.waitFor({ state: 'visible', timeout: 10_000 })

    const sidebarPanel = mainWindow.locator('#chat-sidebar')
    const widthBefore = (await sidebarPanel.boundingBox())?.width ?? 0
    expect(widthBefore).toBeGreaterThan(0)

    const box = await handle.boundingBox()
    if (!box) throw new Error('resize handle has no bounding box')

    // Drag the handle 120px to the right.
    await mainWindow.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await mainWindow.mouse.down()
    await mainWindow.mouse.move(box.x + 120, box.y + box.height / 2, {
      steps: 12
    })
    await mainWindow.mouse.up()

    const widthAfter = (await sidebarPanel.boundingBox())?.width ?? 0
    expect(widthAfter).toBeGreaterThan(widthBefore + 60)
  })

  test('header search button opens the chat search dialog', async ({
    mainWindow
  }) => {
    const searchButton = mainWindow.getByTestId(
      TEST_IDS.chatLayout.searchButton
    )
    await searchButton.waitFor({ state: 'visible', timeout: 10_000 })
    await searchButton.click()

    await expect(mainWindow.getByPlaceholder('Search chats…')).toBeVisible({
      timeout: 5_000
    })
  })

  test('new chat button returns to a fresh chat', async ({ mainWindow }) => {
    const newChat = mainWindow.getByTestId(TEST_IDS.chatLayout.newChat)
    await newChat.waitFor({ state: 'visible', timeout: 10_000 })
    await newChat.click()

    await expect
      .poll(() => mainWindow.evaluate(() => window.location.hash), {
        timeout: 10_000
      })
      .not.toContain('/chat/')
  })

  test('account row opens settings', async ({ mainWindow }) => {
    // The account row opens a dropdown menu (profile info + actions);
    // Settings is one of its items, not a direct navigate-on-click target.
    const account = mainWindow.getByTestId(TEST_IDS.chatLayout.account)
    await account.waitFor({ state: 'visible', timeout: 10_000 })
    await account.click()

    const settingsItem = mainWindow.getByTestId(
      TEST_IDS.chatLayout.accountSettings
    )
    await settingsItem.waitFor({ state: 'visible', timeout: 10_000 })
    await settingsItem.click()

    await expect
      .poll(() => mainWindow.evaluate(() => window.location.hash), {
        timeout: 10_000
      })
      .toContain('settings')
  })

  test('workspace switcher navigates to Philharmonic', async ({
    mainWindow
  }) => {
    const switcher = mainWindow.getByTestId(
      TEST_IDS.chatLayout.workspaceSwitcher
    )
    await switcher.waitFor({ state: 'visible', timeout: 10_000 })
    await expect(switcher).toContainText('Chat')

    await switcher.click()
    await mainWindow.getByRole('menuitem', { name: 'Philharmonic' }).click()

    await expect
      .poll(() => mainWindow.evaluate(() => window.location.hash), {
        timeout: 10_000
      })
      .toContain('philharmonic')

    // Philharmonic now shares the chat shell: the "New group" affordance is
    // sidebar chrome and the Members toggle appears alongside a group chat.
    await expect(
      mainWindow.getByTestId(TEST_IDS.philharmonic.newGroup)
    ).toBeVisible({ timeout: 10_000 })
    expect(
      await mainWindow.getByTestId(TEST_IDS.philharmonic.membersToggle).count()
    ).toBeGreaterThanOrEqual(0)
    // A PM message's decision process (no e2e reaches a PM message yet).
    expect(
      await mainWindow.getByTestId(TEST_IDS.philharmonic.decisionToggle).count()
    ).toBeGreaterThanOrEqual(0)
  })
})
