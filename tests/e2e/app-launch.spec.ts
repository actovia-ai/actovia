/**
 * E2E: Electron app launch and basic window checks.
 */
import { electronTest as test, expect } from '../fixtures/electron'

test.describe('App Launch', () => {
  test('window is created and visible', async ({
    electronApp,
    mainWindow: _mainWindow
  }) => {
    // The app should have at least one window
    const windows = electronApp.windows()
    expect(windows.length).toBeGreaterThanOrEqual(1)

    // Window should be visible
    // DOMContentLoaded can precede ready-to-show on a loaded CI runner.
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isVisible()
        )
      )
      .toBe(true)
  })

  test('window has correct minimum dimensions', async ({
    electronApp,
    mainWindow: _mainWindow
  }) => {
    // Depending on `mainWindow` ensures `firstWindow()` has resolved before we
    // ask the main process for the BrowserWindow list — otherwise on a slow
    // CI runner getAllWindows() can return [] and `size` lands undefined.
    const size = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win?.getSize()
    })

    expect(size).toBeTruthy()
    // Window should be at least 800x600
    expect(size![0]).toBeGreaterThanOrEqual(800)
    expect(size![1]).toBeGreaterThanOrEqual(600)
  })

  test('renderer loads successfully', async ({ mainWindow }) => {
    // The page should not show a blank/error page
    const title = await mainWindow.title()
    expect(title).toBeTruthy()
  })

  test('HTTP server is running', async ({ mainWindow }) => {
    // The main process Hono server should be reachable
    const response = await mainWindow.evaluate(async () => {
      const res = await fetch('http://localhost:60223/api/v1/settings')
      return { status: res.status, ok: res.ok }
    })

    expect(response.status).toBe(200)
    expect(response.ok).toBe(true)
  })
})
