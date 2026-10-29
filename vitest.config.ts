import { tmpdir } from 'os'
import { resolve } from 'path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      { find: '@main', replacement: resolve(import.meta.dirname, 'src/main') },
      { find: '@', replacement: resolve(import.meta.dirname, 'src/renderer') },
      // As in vite.renderer.config.mts: shadcn's bare `cn` is ours.
      {
        find: /^cn$/,
        replacement: resolve(import.meta.dirname, 'src/renderer/lib/cn.ts')
      }
    ]
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    // A scratch data dir per test file, under the default below.
    setupFiles: ['tests/unit/setup/isolated-home.ts'],
    env: {
      // Dev builds use the real ~/.actovia, so a test that imports the real
      // db/db.ts (instead of mocking it) would open — and could write to — the
      // user's actual database. Point every test at a scratch data dir instead.
      ACTOVIA_HOME: resolve(tmpdir(), 'actovia-unit-tests-home')
    },
    // happy-dom rejects a cancelled animation's `finished` promise without
    // marking it handled, as the Web Animations spec says to, so motion (14.4+
    // reads `finished`) stopping an animation surfaces as an unhandled
    // rejection that a browser never reports. Only that one is ignored.
    onUnhandledError: (error) =>
      !(
        error.name === 'AbortError' &&
        error.message === 'The animation was canceled.'
      ),
    coverage: {
      provider: 'v8',
      include: ['packages/shared/src/**', 'src/main/lib/**'],
      exclude: ['**/index.ts']
    }
  }
})
