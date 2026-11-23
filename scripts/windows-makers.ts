import { readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { MakerBase, type MakerOptions } from '@electron-forge/maker-base'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import type { SignToolOptions } from '@electron/windows-sign'
import { Arch, build, Platform, type Configuration } from 'electron-builder'

export function windowsSigningOptions(): SignToolOptions | undefined {
  if (!process.env.WINDOWS_CERTIFICATE_FILE) return undefined
  return {
    certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
    certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
    // windows-sign declares this as a const enum without exporting its value.
    hashes: ['sha256'] as SignToolOptions['hashes'],
    timestampServer: 'http://timestamp.digicert.com'
  }
}

/** Keep the existing x64 installation's Squirrel update feed working. */
export class LegacySquirrelMaker extends MakerSquirrel {
  override async make(options: MakerOptions): Promise<string[]> {
    if (options.targetArch !== 'x64') return []
    return super.make(options)
  }
}

export function windowsInstallerConfig(
  arch: string,
  output: string
): Configuration {
  if (arch !== 'x64' && arch !== 'arm64')
    throw new Error(`Unsupported Windows architecture: ${arch}`)
  const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE
  if (certificateFile && !process.env.WINDOWS_PUBLISHER_NAME) {
    throw new Error(
      'WINDOWS_PUBLISHER_NAME is required for trusted update verification'
    )
  }
  return {
    appId: 'app.yancey.actovia',
    productName: 'Actovia',
    directories: { output, buildResources: resolve('build') },
    artifactName: 'Actovia-${version}-${arch}-Setup.${ext}',
    npmRebuild: false,
    forceCodeSigning: Boolean(certificateFile),
    // The Forge package already contains the runtime, ASAR and native modules.
    win: {
      icon: resolve('build/icon.ico'),
      executableName: 'Actovia',
      requestedExecutionLevel: 'asInvoker',
      ...(certificateFile
        ? {
            signtoolOptions: {
              certificateFile,
              signingHashAlgorithms: ['sha256'],
              rfc3161TimeStampServer: 'http://timestamp.digicert.com',
              ...(process.env.WINDOWS_PUBLISHER_NAME
                ? { publisherName: process.env.WINDOWS_PUBLISHER_NAME }
                : {})
            }
          }
        : {})
    },
    nsis: {
      include: resolve('build/installer.nsh'),
      oneClick: false,
      perMachine: false,
      selectPerMachineByDefault: false,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: 'always',
      createStartMenuShortcut: true,
      shortcutName: 'Actovia',
      installerIcon: resolve('build/icon.ico'),
      uninstallerIcon: resolve('build/icon.ico'),
      installerSidebar: resolve('build/installer-sidebar.bmp'),
      uninstallerSidebar: resolve('build/installer-sidebar.bmp'),
      deleteAppDataOnUninstall: false
    },
    publish: {
      provider: 'github',
      owner: 'actovia-ai',
      repo: 'actovia',
      // Separate feeds: never let an ARM64 install download an x64 update.
      channel: arch === 'arm64' ? 'latest-arm64' : 'latest'
    }
  }
}

/** Forge remains the packager; NSIS supplies the standard Windows wizard. */
export class WindowsWizardMaker extends MakerBase<Record<string, never>> {
  name = 'actovia-windows-wizard'
  defaultPlatforms: MakerBase<Record<string, never>>['platforms'] = ['win32']

  isSupportedOnCurrentPlatform() {
    return process.platform === 'win32'
  }

  async make({
    dir,
    makeDir,
    targetArch,
    packageJSON
  }: MakerOptions): Promise<string[]> {
    const output = resolve(makeDir, 'nsis', targetArch)
    await this.ensureDirectory(output)
    const config = windowsInstallerConfig(targetArch, output)
    // prepackaged skips electron-builder's afterPack hook, which normally
    // writes this file. In particular, preserve the trusted publisher name
    // so signed installations verify the publisher of downloaded updates.
    await writeFile(
      join(dir, 'resources/app-update.yml'),
      JSON.stringify({
        provider: 'github',
        owner: 'actovia-ai',
        repo: 'actovia',
        channel: targetArch === 'arm64' ? 'latest-arm64' : 'latest',
        updaterCacheDirName: 'actovia-updater',
        ...(process.env.WINDOWS_PUBLISHER_NAME
          ? { publisherName: [process.env.WINDOWS_PUBLISHER_NAME] }
          : {})
      })
    )
    await build({
      prepackaged: dir,
      targets: Platform.WINDOWS.createTarget(
        'nsis',
        targetArch === 'arm64' ? Arch.arm64 : Arch.x64
      ),
      publish: 'never',
      config
    })
    const installer = `Actovia-${packageJSON.version}-${targetArch}-Setup.exe`
    const expected = [
      installer,
      `${installer}.blockmap`,
      targetArch === 'arm64' ? 'latest-arm64.yml' : 'latest.yml'
    ]
    const files = await readdir(output)
    for (const file of expected) {
      if (!files.includes(file))
        throw new Error(`Windows installer artifact missing: ${file}`)
    }
    return expected.map((file) => join(output, file))
  }
}
