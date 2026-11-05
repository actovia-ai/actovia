import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:63131',
    channel: 'chrome',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'bun tests/browser/fixtures/server.ts',
    url: 'http://localhost:63131',
    reuseExistingServer: false,
    timeout: 20_000
  },
  reporter: [['list']]
})
