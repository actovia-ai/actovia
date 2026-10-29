import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'

/**
 * The macOS update feed electron-updater reads (ISSUE-290): `latest-mac.yml`
 * beside the release's zip, and a `<zip>.blockmap` that lets the next version
 * download only the blocks of the zip that changed. electron-builder writes
 * both; electron-forge does neither, so forge.config.ts's `postMake` calls
 * `writeMacUpdateFeed()` and the files ship as release assets with the rest.
 */

export interface FeedFile {
  /** The asset's file name — electron-updater resolves it against the release. */
  url: string
  /** base64 SHA-512 of the file, what electron-updater verifies the download by. */
  sha512: string
  size: number
}

const execFileAsync = promisify(execFile)

/** `latest-mac.yml`, in the shape electron-builder writes it. */
export function latestMacYml(
  version: string,
  files: FeedFile[],
  releaseDate: string
): string {
  const [first] = files
  if (!first) throw new Error('latest-mac.yml needs at least one file')
  const lines = [`version: ${version}`, 'files:']
  for (const file of files) {
    lines.push(
      `  - url: ${file.url}`,
      `    sha512: ${file.sha512}`,
      `    size: ${file.size}`
    )
  }
  // The top-level `path` / `sha512` are what electron-updater's older readers
  // take; current ones read `files`.
  lines.push(
    `path: ${first.url}`,
    `sha512: ${first.sha512}`,
    `releaseDate: '${releaseDate}'`
  )
  return `${lines.join('\n')}\n`
}

export async function sha512Base64(path: string): Promise<string> {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('base64')
}

/**
 * Writes `<zip>.blockmap` for every zip among a make result's artifacts and
 * `latest-mac.yml` naming them, in the zips' directory; returns the new
 * files' paths for the make result. No zip, nothing written.
 */
export async function writeMacUpdateFeed(
  artifacts: string[],
  version: string,
  appBuilderPath: string,
  now: Date = new Date()
): Promise<string[]> {
  const zips = artifacts.filter((path) => path.endsWith('.zip'))
  const [firstZip] = zips
  if (!firstZip) return []
  // bun installs app-builder-bin's binaries without the executable bit.
  await chmod(appBuilderPath, 0o755)
  const written: string[] = []
  const files: FeedFile[] = []
  for (const zip of zips) {
    const blockmap = `${zip}.blockmap`
    await execFileAsync(appBuilderPath, [
      'blockmap',
      '--input',
      zip,
      '--output',
      blockmap
    ])
    written.push(blockmap)
    files.push({
      url: basename(zip),
      sha512: await sha512Base64(zip),
      size: (await stat(zip)).size
    })
  }
  const yml = join(dirname(firstZip), 'latest-mac.yml')
  await writeFile(yml, latestMacYml(version, files, now.toISOString()))
  written.push(yml)
  return written
}
