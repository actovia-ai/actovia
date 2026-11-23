import { readFileSync } from 'node:fs'

import { validateConfiguration } from 'app-builder-lib/out/util/config/config'
import { DebugLogger } from 'builder-util'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  windowsInstallerConfig,
  windowsSigningOptions
} from '../../../scripts/windows-makers'

afterEach(() => vi.unstubAllEnvs())

describe('Windows installer configuration', () => {
  it.each(['x64', 'arm64'])(
    'validates the %s wizard against electron-builder’s schema',
    async (arch) => {
      const config = windowsInstallerConfig(arch, `/tmp/actovia-nsis-${arch}`)
      await validateConfiguration(config, new DebugLogger(false))
      expect(config.nsis).toMatchObject({
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        deleteAppDataOnUninstall: false
      })
      const include = readFileSync(config.nsis!.include!, 'utf8')
      expect(include).toContain('ManifestDPIAware true')
      const sidebar = readFileSync(config.nsis!.installerSidebar!)
      expect(sidebar.readInt32LE(18)).toBe(492)
      expect(sidebar.readInt32LE(22)).toBe(942)
      expect(config.win?.requestedExecutionLevel).toBe('asInvoker')
      expect(config.publish).toMatchObject({
        channel: arch === 'arm64' ? 'latest-arm64' : 'latest'
      })
      expect(config.artifactName).toContain('${arch}')
    }
  )

  it('configures optional signing without putting the password in builder’s effective config', async () => {
    vi.stubEnv('WINDOWS_CERTIFICATE_FILE', 'C:\\signing\\dummy.pfx')
    vi.stubEnv('WINDOWS_CERTIFICATE_PASSWORD', 'dummy-test-only')
    vi.stubEnv('WINDOWS_PUBLISHER_NAME', 'Test Publisher')
    const config = windowsInstallerConfig('arm64', '/tmp/actovia-nsis-test')
    await validateConfiguration(config, new DebugLogger(false))
    expect(config.win?.signtoolOptions?.signingHashAlgorithms).toEqual([
      'sha256'
    ])
    expect(JSON.stringify(config)).not.toContain('dummy-test-only')
    expect(windowsSigningOptions()?.hashes).toEqual(['sha256'])
  })
})
