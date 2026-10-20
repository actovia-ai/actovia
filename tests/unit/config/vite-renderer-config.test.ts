import { describe, expect, it } from 'vitest'

import config from '../../../vite.renderer.config.mts'

describe('vite.renderer.config', () => {
  // Guards a dev-only failure that unit tests and production builds can't see:
  // @actovia/shared's i18n loader uses `import.meta.glob`, which Vite's dev
  // pre-bundler silently replaces with `Object.assign({})` — no catalog ever
  // loads and the UI shows raw keys (`messageList.greetingTitle`). Serving the
  // package as source (not pre-bundled) is what keeps the glob working.
  it('keeps the @actovia/shared workspace package out of dev pre-bundling', () => {
    expect(config.optimizeDeps?.exclude).toContain('@actovia/shared')
  })

  // The second dev-only trap: @electron-forge/plugin-vite forces
  // `preserveSymlinks: true`, so the package stays under node_modules and Vite
  // serves it as an immutable, unwatched dependency — an edit (e.g. a changed
  // SERVER_PORT) never reaches the dev renderer, even after a restart, until a
  // hard reload. Our config is merged over Forge's, so this overrides it.
  it('resolves workspace symlinks so shared code is served as watched source', () => {
    expect(config.resolve?.preserveSymlinks).toBe(false)
  })
})
