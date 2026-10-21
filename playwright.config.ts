import { tmpdir } from 'os'
import path from 'path'

import { defineConfig } from '@playwright/test'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '.env.test') })

// Scratch $HOME for the whole run. The app under test keeps its data in
// ~/.actovia, and the specs that seed lock files read the same path through
// os.homedir() — a fixed dir (not mkdtemp: every worker re-evaluates this
// file) keeps them in agreement without ever touching the real home. The
// electron fixture refuses to run (it wipes ~/.actovia) unless HOME is this dir.
process.env.HOME = path.join(tmpdir(), 'actovia-e2e-home')
// ...and an ACTOVIA_HOME left in the shell must not override it.
delete process.env.ACTOVIA_HOME

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 60_000,

  use: {
    trace: 'on-first-retry'
  },

  projects: [
    // ── Layer 1: API integration tests (no Electron needed) ──
    {
      name: 'api',
      testDir: './tests/api',
      timeout: 120_000
    },

    // ── Layer 2: Electron E2E tests ──
    {
      name: 'e2e',
      testDir: './tests/e2e',
      timeout: 60_000
    },

    // ── Layer 3: Provider compatibility ──
    {
      name: 'providers',
      testDir: './tests/providers',
      timeout: 120_000
    }
  ]
})
