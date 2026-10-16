// tests/unit/main/lib/agents/process.test.ts — the supervisor on its own
import { chmodSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { superviseProcess, type ExitInfo } from '@main/lib/agents/process'
import { describe, expect, it } from 'vitest'

function script(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sup-'))
  const file = join(dir, 'child.sh')
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)
  return file
}

function run(body: string) {
  const dir = mkdtempSync(join(tmpdir(), 'sup-log-'))
  const lines: string[] = []
  let exit: ExitInfo | null = null
  let finished!: () => void
  const done = new Promise<void>((ok) => {
    finished = ok
  })
  const sup = superviseProcess({
    binPath: script(body),
    args: [],
    cwd: dir,
    env: { PATH: process.env.PATH ?? '' },
    logPath: join(dir, 'log'),
    onLine: (l) => lines.push(l),
    onExit: (e) => {
      exit = e
      finished()
    }
  })
  return { lines, done, sup, exit: () => exit }
}

describe('superviseProcess', () => {
  it('delivers every line before the exit', async () => {
    const r = run('for i in 1 2 3; do echo "{\\"n\\":$i}"; done')
    await r.done
    expect(r.lines).toEqual(['{"n":1}', '{"n":2}', '{"n":3}'])
    expect(r.exit()).toMatchObject({ code: 0, expected: false })
  })

  it('reports a failed handshake as an unexpected exit carrying the message', async () => {
    const r = run('exec sleep 30')
    await r.sup.fail('Not logged in')
    await r.done
    expect(r.exit()).toMatchObject({
      expected: false,
      stderrTail: 'Not logged in'
    })
  })

  it('stop ends the child and marks the exit expected', async () => {
    const r = run('cat')
    await r.sup.stop()
    await r.done
    expect(r.exit()).toMatchObject({ expected: true })
  })
})
