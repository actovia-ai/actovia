import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerRpm } from '@electron-forge/maker-rpm'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { PublisherGitHub } from '@electron-forge/publisher-github'
import type { ForgeConfig } from '@electron-forge/shared-types'
import { FuseV1Options, FuseVersion } from '@electron/fuses'

// Relative: Forge loads this file itself, without the Vite aliases.
import { APP_DISPLAY_NAME } from './packages/shared/src/constants/brand'

const config: ForgeConfig = {
  packagerConfig: {
    // Unpack DuckDB from the asar: AutoUnpackNativesPlugin only extracts
    // `*.node`, but `duckdb.node` dlopens `libduckdb.<dylib|so|dll>` next to
    // itself, and a dlopen cannot read inside the archive. (The plugin merges
    // this pattern with its own rather than replacing it.)
    asar: { unpack: '**/node_modules/@duckdb/**' },
    icon: './build/icon',
    extraResource: ['./resources'],
    // The bundle a person sees is Actovia; package.json's productName stays
    // "Exodus" (the runtime name: Keychain item, userData, single-instance
    // lock). Windows keeps Exodus.exe: a Squirrel update would otherwise leave
    // an Exodus.lnk pointing at a missing exe.
    name: APP_DISPLAY_NAME,
    executableName: process.platform === 'win32' ? 'Exodus' : APP_DISPLAY_NAME,
    appBundleId: 'app.yancey.exodus',
    appCategoryType: 'public.app-category.utilities',
    // macOS permission prompts' purpose strings (carried over from
    // universal-client's electron-builder `mac.extendInfo`). Signing with
    // build/entitlements.mac.plist isn't wired (`osxSign`) — this repo
    // doesn't sign builds yet; add it together with a signing identity.
    extendInfo: {
      NSCameraUsageDescription:
        "Application requests access to the device's camera.",
      NSMicrophoneUsageDescription:
        "Application requests access to the device's microphone.",
      NSDocumentsFolderUsageDescription:
        "Application requests access to the user's Documents folder.",
      NSDownloadsFolderUsageDescription:
        "Application requests access to the user's Downloads folder."
    },
    // TODO(signing): the owner has applied for the Apple Developer Program
    // (2026-10-19). Signing is one later change: set `osxSign` (identity,
    // hardened runtime, entitlements) and `osxNotarize` here, with the secrets
    // in release.yml (CLAUDE.md "Updates and code signing"). Until then
    // `osxSign` stays unset so the postPackage ad-hoc re-sign keeps the bundle
    // valid.
    // @electron-forge/plugin-vite normally sets `ignore` itself, excluding
    // everything except `.vite/**` on the assumption the whole app is
    // bundled into it. That breaks `@electric-sql/pglite` (and its two
    // extension packages), which vite.main.config.mts deliberately keeps
    // external — PGlite resolves its own WASM/data assets relative to its
    // real package location (via `__filename`) at runtime, which only
    // works if those real, unbundled files are actually shipped. Providing
    // our own `ignore` here (matching the plugin's default, plus these
    // three packages) opts out of the plugin's auto-injection — verified
    // by reading VitePlugin.js's resolveForgeConfig, which only overrides
    // `ignore` when packagerConfig.ignore is unset.
    ignore: (file: string) => {
      if (!file) return false
      if (file.startsWith('/.vite')) return false
      // Ancestor directories (e.g. `/node_modules`) must also be kept, not
      // just the leaf files — the packager's walker prunes recursion at
      // the first ignored directory, so allowing only the deep path left
      // nothing on disk to recurse into. Verified by an empty asar listing
      // with only the leaf-path check in place.
      // Same rule for DuckDB (lib/analytics/duckdb.ts): the Node-API binding
      // plus the platform package it requires at runtime, and `detect-libc`,
      // its one runtime dependency.
      const kept = [
        '/node_modules/@electric-sql',
        '/node_modules/@duckdb',
        '/node_modules/detect-libc'
      ]
      for (const target of kept) {
        if (
          file === target ||
          file.startsWith(`${target}/`) ||
          target.startsWith(file)
        ) {
          return false
        }
      }
      return true
    }
  },
  rebuildConfig: {},
  hooks: {
    // The packager rewrites the bundle's Info.plist (bundle id, purpose
    // strings…) and the fuses plugin flips the executable, which only gets an
    // ad-hoc signature of its own — so the bundle's seal no longer matches:
    // `codesign --verify` says "invalid Info.plist (plist or signature have
    // been modified)", and that is exactly the error every downloaded update
    // failed with. Seal the whole bundle once, after everything has touched it.
    // Skipped when a real identity is configured (`osxSign`), which signs
    // properly itself — that is the switch to flip once a Developer ID exists
    // (see "Updates and code signing" in CLAUDE.md).
    postPackage: async (forgeConfig, { platform, outputPaths }) => {
      if (
        platform !== 'darwin' ||
        process.platform !== 'darwin' ||
        forgeConfig.packagerConfig.osxSign
      ) {
        return
      }
      for (const dir of outputPaths) {
        for (const entry of readdirSync(dir)) {
          if (!entry.endsWith('.app')) continue
          execFileSync(
            '/usr/bin/codesign',
            ['--force', '--deep', '--sign', '-', join(dir, entry)],
            { stdio: 'inherit' }
          )
        }
      }
    }
  },
  makers: [
    new MakerSquirrel({ setupIcon: './build/icon.ico' }),
    // ZIP feeds the auto-updater (update.electronjs.org needs
    // `*-darwin-*.zip`); the DMG is what people download.
    new MakerZIP({}, ['darwin']),
    new MakerDMG({}, ['darwin']),
    // The Linux executable follows `executableName` ("Actovia"), but these two
    // makers default `bin` to package.json's `name` ("exodus") and fail with
    // "could not find the Electron app binary" — Linux paths are case-sensitive.
    new MakerRpm({
      options: { bin: APP_DISPLAY_NAME, productName: APP_DISPLAY_NAME }
    }),
    new MakerDeb({
      options: { bin: APP_DISPLAY_NAME, productName: APP_DISPLAY_NAME }
    })
  ],
  // Manual publishing to GitHub Releases — the prerequisite for the free
  // update.electronjs.org auto-update service (see lib/auto-updater.ts, which
  // derives the repo from package.json's `repository`, so keep the two in
  // sync). Auth: set GITHUB_TOKEN when running `electron-forge publish`.
  // CI does not use this: .github/workflows/release.yml builds with `make`
  // and lets semantic-release create the release, then attaches the assets.
  publishers: [
    new PublisherGitHub({
      repository: {
        owner: 'actovia-ai',
        name: 'actovia'
      }
    })
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry`'s basename drives the output filename ([name].js) —
          // it must be `main`/`preload` to match `target`, not `index`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.mts',
          target: 'main'
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload'
        }
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts'
        }
      ]
    }),
    // Unpacks native (.node) modules from the asar at package time — they
    // can't be dlopen'd from inside the archive. No-op until a dependency
    // actually ships one, but wiring it now means nobody has to remember to
    // add it later.
    new AutoUnpackNativesPlugin({}),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
}

export default config
