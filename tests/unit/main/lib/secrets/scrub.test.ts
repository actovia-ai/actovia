// `scrubLogFiles` (fix round 3): each file is rewritten atomically — a temp
// file in the same directory, renamed over it, the mode kept — and on its
// own: a file over the size cap is skipped and logged, a file that cannot be
// read is counted as failed, and neither stops the others.
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const { scrubLogFiles } = await import('@main/lib/secrets/scrub')

const SECRET = 'sk-scrub-file-secret-0123456789'
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'actovia-scrub-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const put = (name: string, body: string, mode = 0o640) => {
  writeFileSync(join(dir, name), body)
  chmodSync(join(dir, name), mode)
}

describe('scrubLogFiles', () => {
  it('rewrites through a temp file and a rename, keeping the mode', () => {
    put('a.jsonl', JSON.stringify({ body: SECRET }) + '\n', 0o600)
    const before = statSync(join(dir, 'a.jsonl')).ino
    const r = scrubLogFiles(dir, [SECRET])
    expect(r).toEqual({ changed: 1, skipped: 0, failed: 0 })
    expect(readFileSync(join(dir, 'a.jsonl'), 'utf8')).not.toContain(SECRET)
    expect(statSync(join(dir, 'a.jsonl')).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, 'a.jsonl')).ino).not.toBe(before)
    expect(readdirSync(dir)).toEqual(['a.jsonl'])
  })

  it('skips a file over the cap and a file it cannot read, and scrubs the rest', () => {
    put('big.jsonl', `${SECRET}\n`.repeat(100))
    put('locked.jsonl', `${SECRET}\n`, 0o000)
    put('ok.jsonl', `${SECRET}\n`)
    try {
      const r = scrubLogFiles(dir, [SECRET], { maxBytes: 1000 })
      expect(r).toEqual({ changed: 1, skipped: 1, failed: 1 })
      expect(readFileSync(join(dir, 'ok.jsonl'), 'utf8')).not.toContain(SECRET)
      expect(readFileSync(join(dir, 'big.jsonl'), 'utf8')).toContain(SECRET)
    } finally {
      chmodSync(join(dir, 'locked.jsonl'), 0o600)
    }
  })

  it('removes the temp file a crash left mid-rewrite (S2 minor)', () => {
    put('.a.jsonl.scrub-4242.tmp', `${SECRET}\n`)
    put('a.jsonl', '{"body":"ok"}\n')
    put('.notes.tmp', 'kept')
    scrubLogFiles(dir, [SECRET])
    expect(readdirSync(dir).toSorted()).toEqual(['.notes.tmp', 'a.jsonl'])
  })

  it('leaves a file with nothing to scrub untouched', () => {
    put('clean.jsonl', '{"body":"ok"}\n')
    const before = statSync(join(dir, 'clean.jsonl')).ino
    expect(scrubLogFiles(dir, [SECRET]).changed).toBe(0)
    expect(statSync(join(dir, 'clean.jsonl')).ino).toBe(before)
  })
})
