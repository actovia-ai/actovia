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
import { appBuilderPath } from 'app-builder-bin'

// Relative: Forge loads this file itself, without the Vite aliases.
import DMG from './brand/dmg.json'
import { APP_DISPLAY_NAME } from './packages/shared/src/constants/brand'
import { writeMacUpdateFeed } from './scripts/mac-update-feed'

// macOS signing is switched on by the environment, so a build without it
// (`bun run package` for e2e, a fork's CI) stays ad-hoc and still valid (see
// the postPackage hook). `APPLE_SIGNING_IDENTITY` names a keychain identity,
// e.g. "Developer ID Application: Yanzhao Liu (A542S7SY83)"; release.yml
// imports the certificate from secrets. A signature by one identity keeps the
// app's designated requirement the same across versions, so the Keychain
// item "Actovia Safe Storage" stops asking for the password after an update
// and Squirrel.Mac can install updates (CLAUDE.md "Updates and code signing").
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY || undefined

// Notarization needs a signed build and one of two credentials: an App Store
// Connect API key (the .p8 file's path, its id and the issuer) or an Apple ID
// with an app-specific password and the team id. Neither set: signed, not
// notarized — Gatekeeper then still asks on first open of a download.
function notarizeOptions(): NonNullable<
  ForgeConfig['packagerConfig']
>['osxNotarize'] {
  if (!signingIdentity) return undefined
  const env = process.env
  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) {
    return {
      appleApiKey: env.APPLE_API_KEY,
      appleApiKeyId: env.APPLE_API_KEY_ID,
      appleApiIssuer: env.APPLE_API_ISSUER
    }
  }
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    return {
      appleId: env.APPLE_ID,
      appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: env.APPLE_TEAM_ID
    }
  }
  return undefined
}

const config: ForgeConfig = {
  packagerConfig: {
    // Unpack DuckDB from the asar: AutoUnpackNativesPlugin only extracts
    // `*.node`, but `duckdb.node` dlopens `libduckdb.<dylib|so|dll>` next to
    // itself, and a dlopen cannot read inside the archive. (The plugin merges
    // this pattern with its own rather than replacing it.)
    asar: { unpack: '**/node_modules/@duckdb/**' },
    icon: './build/icon',
    // app-update.yml: electron-updater reads it from Contents/Resources before
    // every macOS download, for its cache directory (ISSUE-290).
    extraResource: ['./resources', './build/app-update.yml'],
    // The bundle a person sees is Actovia; package.json's productName stays
    // "Actovia" (the runtime name: Keychain item, userData, single-instance
    // lock). Windows keeps Actovia.exe: a Squirrel update would otherwise leave
    // an Actovia.lnk pointing at a missing exe.
    name: APP_DISPLAY_NAME,
    executableName: process.platform === 'win32' ? 'Actovia' : APP_DISPLAY_NAME,
    appBundleId: 'app.yancey.actovia',
    appCategoryType: 'public.app-category.utilities',
    // macOS permission prompts' purpose strings (carried over from
    // universal-client's electron-builder `mac.extendInfo`). Under the
    // hardened runtime a signed build also needs the matching entitlement in
    // build/entitlements.mac.plist (camera, microphone).
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
    // Every Mach-O in the bundle is signed — the DuckDB `.node` / dylib under
    // app.asar.unpacked and resources/bin/actovia-input included — with the
    // hardened runtime and the one entitlements file (osx-sign's default
    // would give helpers a narrower set; Electron's helpers need JIT too).
    osxSign: signingIdentity
      ? {
          identity: signingIdentity,
          optionsForFile: () => ({
            hardenedRuntime: true,
            entitlements: './build/entitlements.mac.plist'
          })
        }
      : undefined,
    osxNotarize: notarizeOptions(),
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
    // Skipped when a real identity is configured (`osxSign`, from
    // APPLE_SIGNING_IDENTITY), which signs the whole bundle itself after the
    // fuses (see "Updates and code signing" in CLAUDE.md).
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
    },
    // The macOS update feed (ISSUE-290): electron-updater reads
    // `latest-mac.yml` from the release and downloads only the changed blocks
    // of the zip through its `.blockmap`. Forge writes neither, so they are
    // made here and added to the make result; release.yml uploads them.
    postMake: async (_forgeConfig, makeResults) => {
      for (const result of makeResults) {
        if (result.platform !== 'darwin') continue
        result.artifacts.push(
          ...(await writeMacUpdateFeed(
            result.artifacts,
            result.packageJSON.version,
            appBuilderPath
          ))
        )
      }
      return makeResults
    }
  },
  makers: [
    new MakerSquirrel({ setupIcon: './build/icon.ico' }),
    // ZIP feeds the auto-updater (electron-updater, through latest-mac.yml and
    // the zip's blockmap — see postMake) and `actovia app update`; the DMG is
    // what people download.
    new MakerZIP({}, ['darwin']),
    // The installer window: background and icon positions come from
    // brand/art.mjs (`bun run icons` renders build/dmg-background{,@2x}.png),
    // and the mounted volume shows the app icon instead of Electron's.
    new MakerDMG(
      {
        background: './build/dmg-background.png',
        icon: './build/icon.icns',
        iconSize: 128,
        contents: (opts) => [
          { x: DMG.app[0], y: DMG.app[1], type: 'file', path: opts.appPath },
          {
            x: DMG.apps[0],
            y: DMG.apps[1],
            type: 'link',
            path: '/Applications'
          }
        ]
      },
      ['darwin']
    ),
    // The Linux executable follows `executableName` ("Actovia"), but these two
    // makers default `bin` to package.json's `name` ("actovia") and fail with
    // "could not find the Electron app binary" — Linux paths are case-sensitive.
    new MakerRpm({
      options: { bin: APP_DISPLAY_NAME, productName: APP_DISPLAY_NAME }
    }),
    new MakerDeb({
      options: { bin: APP_DISPLAY_NAME, productName: APP_DISPLAY_NAME }
    })
  ],
  // Manual publishing to GitHub Releases, which both updaters read (see
  // lib/auto-updater.ts: electron-updater on macOS, update.electronjs.org on
  // Windows). Auth: set GITHUB_TOKEN when running `electron-forge publish`.
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
