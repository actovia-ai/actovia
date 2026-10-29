import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { appBuilderPath } from 'app-builder-bin'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  latestMacYml,
  writeMacUpdateFeed
} from '../../../scripts/mac-update-feed'

describe('latestMacYml', () => {
  it('writes the shape electron-builder writes', () => {
    const yml = latestMacYml(
      '2.5.0',
      [{ url: 'Actovia-darwin-arm64-2.5.0.zip', sha512: 'abc==', size: 42 }],
      '2026-10-29T04:00:00.000Z'
    )
    expect(yml).toBe(
      [
        'version: 2.5.0',
        'files:',
        '  - url: Actovia-darwin-arm64-2.5.0.zip',
        '    sha512: abc==',
        '    size: 42',
        'path: Actovia-darwin-arm64-2.5.0.zip',
        'sha512: abc==',
        "releaseDate: '2026-10-29T04:00:00.000Z'",
        ''
      ].join('\n')
    )
  })

  it('refuses an empty feed', () => {
    expect(() => latestMacYml('2.5.0', [], 'x')).toThrow()
  })
})

describe('writeMacUpdateFeed', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mac-feed-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes nothing without a zip', async () => {
    expect(
      await writeMacUpdateFeed(
        [join(dir, 'Actovia.dmg')],
        '2.5.0',
        appBuilderPath
      )
    ).toEqual([])
  })

  it('writes a real blockmap and a yml naming the zip by its hash', async () => {
    const zip = join(dir, 'Actovia-darwin-arm64-2.5.0.zip')
    await writeFile(zip, Buffer.alloc(300_000, 7))
    const written = await writeMacUpdateFeed(
      [zip, join(dir, 'Actovia-2.5.0-arm64.dmg')],
      '2.5.0',
      appBuilderPath,
      new Date('2026-10-29T04:00:00.000Z')
    )
    expect(written).toEqual([`${zip}.blockmap`, join(dir, 'latest-mac.yml')])

    const blockmap = JSON.parse(
      gunzipSync(await readFile(`${zip}.blockmap`)).toString()
    )
    expect(blockmap.version).toBe('2')
    expect(
      blockmap.files[0].sizes.reduce((a: number, b: number) => a + b, 0)
    ).toBe(300_000)

    const sha512 = createHash('sha512')
      .update(await readFile(zip))
      .digest('base64')
    const yml = await readFile(join(dir, 'latest-mac.yml'), 'utf8')
    expect(yml).toContain(
      `  - url: Actovia-darwin-arm64-2.5.0.zip\n    sha512: ${sha512}\n    size: ${(await stat(zip)).size}`
    )
    expect(yml).not.toContain('dmg')
  })
})
