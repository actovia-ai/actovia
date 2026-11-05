import { join } from 'node:path'

import { PluginBase } from '@electron-forge/plugin-base'
import type { ForgeMultiHookMap } from '@electron-forge/shared-types'
import { build } from 'vite'

/** Runs after VitePlugin's preStart cleanup and before Electron is launched. */
export class WebEntryPlugin extends PluginBase<{ projectRoot: string }> {
  name = 'actovia-web-entry'

  getHooks(): ForgeMultiHookMap {
    return {
      preStart: async () => {
        await build({
          root: this.config.projectRoot,
          configFile: join(this.config.projectRoot, 'vite.web.config.mts')
        })
      }
    }
  }
}
