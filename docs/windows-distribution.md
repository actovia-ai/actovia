# Windows and Linux distribution (ISSUE-414)

Release and PR builds run natively on five runners: macOS ARM64, Windows x64,
Windows ARM64, Linux x64 and Linux ARM64. `npm_config_arch` and Forge's `--arch`
match the runner. `verify-package-architecture.mjs` checks the packaged Electron
executable, DuckDB binding and shared library, rather than trusting file names.

| Platform                                    | Download for a new installation                           |
| ------------------------------------------- | --------------------------------------------------------- |
| Windows Intel / AMD                         | `Actovia-<version>-x64-Setup.exe`                         |
| Windows ARM64 (including Apple silicon VMs) | `Actovia-<version>-arm64-Setup.exe`                       |
| Debian / Ubuntu x64                         | `actovia_<version>_amd64.deb`                             |
| Debian / Ubuntu ARM64                       | `actovia_<version>_arm64.deb`                             |
| RPM Linux x64                               | `actovia-<version>-1.x86_64.rpm`                          |
| RPM Linux ARM64                             | `actovia-<version>-1.arm64.rpm` (RPM metadata: `aarch64`) |

Electron 45 and the bundled native dependencies target 64-bit ARM, not ARMv7.
The website recognizes architecture client hints, falls back to the user agent,
and always offers an explicit architecture selector. An absent ARM64 artifact
links to the release page instead of silently downloading x64.

## Installation and updates

Forge still builds the application. `WindowsWizardMaker` passes that package
to electron-builder's NSIS target: standard install/uninstall wizards, selectable
directory and shortcuts, defaulting to the current user. The application runs
`asInvoker`; choosing an all-users install can request normal elevation.
Uninstall does not remove the user's database.

New NSIS installs use electron-updater, `latest.yml` for x64 and
`latest-arm64.yml` for ARM64, with separate EXE blockmaps. Existing Squirrel x64
installs keep their `Update.exe`, nupkg and `RELEASES` feed and continue updating
through update.electronjs.org. Their old `Actovia-<version> Setup.exe` remains
only for compatibility. The app detects `Update.exe` next to `app-<version>`
and selects the matching updater and shortcut AUMID. Do not give ARM64 packages
Squirrel's shared `RELEASES` file; its public update service uses that one file
for all Windows architectures.

The icon source is `actovia-ai/assets/scripts/render-icons.mjs`. From this
checkout, `bun run icons --desktop-only` refreshes all Windows/Linux icon sizes,
the NSIS sidebar and Squirrel's branded loading panel. The renderer needs
Playwright/Chromium and ffmpeg; regular builds use the committed images.

## Trusted Windows signing

Changing installer UI, using `asInvoker`, or running as administrator does not
give an unsigned EXE a trusted publisher. A signature also does not guarantee
instant SmartScreen reputation. Do not ask users to disable Windows Security.

Microsoft documents two distinct distribution paths:

- [Microsoft Store MSIX](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options):
  the Store signs the package for free after certification. Developer account
  enrollment and identity verification are still required. This does not sign
  the EXE distributed on GitHub/the website.
- [SignPath Foundation](https://signpath.org/terms): free signing for eligible
  open-source projects, subject to application, project/build review and approval.
  Actovia's MIT repository can be evaluated for this program; approval and a
  certificate have **not** been obtained as part of ISSUE-414. A SignPath-issued
  Foundation certificate identifies the Foundation, not the maintainer personally.

The release workflow supports an existing exportable trusted certificate via:

- Secrets `WINDOWS_CERTIFICATE` (base64 PFX) and `WINDOWS_CERTIFICATE_PASSWORD`.
- Repository variable `WINDOWS_PUBLISHER_NAME` (exact certificate publisher).

The PFX is decoded only into the runner's temporary directory and removed with
`always()`. Forge signs the packaged app and Squirrel's updater/installer; NSIS
signs its installer and uninstaller. SHA-256 and RFC 3161 timestamps are used.
The workflow verifies Authenticode on every generated Windows installer before
upload. Without a certificate these builds remain unsigned; do not describe
the Windows Security warning as resolved.

For local signing, set `WINDOWS_CERTIFICATE_FILE`, `WINDOWS_CERTIFICATE_PASSWORD`,
`WIN_CSC_KEY_PASSWORD` (same password, read by electron-builder) and
`WINDOWS_PUBLISHER_NAME`. Hardware/cloud certificates need a provider-specific
integration rather than an exported PFX; never export or commit a private key
to fit this interface.

## Validation

Before publishing, run the PR build matrix (also available through
`workflow_dispatch`) and test the resulting installers on Windows x64 and ARM64:

1. Install as a normal user into the default current-user directory; check
   installer, shortcut, taskbar and application icons at multiple DPI settings.
2. Check minimize/maximize/close, Windows Snap Layouts, keyboard system menu,
   settings and the lock screen. Windows/Linux use native caption buttons.
3. Import a Mac-exported ZIP with Chinese text, commas, multiline JSON and chat
   messages; compare content. A malformed later CSV must roll back the entire
   replacement. Machine-bound settings/secrets remain local.
4. Check About/system diagnostics identify ARM64, then compare scrolling and
   streaming on the same VM. Native architecture removes x64 emulation but
   VM GPU drivers and host resource limits can still affect responsiveness.
5. Test NSIS x64 → next x64, NSIS ARM64 → next ARM64 and existing Squirrel x64
   → next Squirrel x64. Keep architecture-specific manifests and blockmaps.
