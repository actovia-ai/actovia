import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { constants } from 'fs'
import { lstat, mkdir, open, readdir, unlink } from 'fs/promises'
import { join } from 'path'

import { getActoviaHome } from '../paths'

export const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
export const appleScriptString = (s: string) =>
  `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

/** Backslash-escapes a path so sh, bash, zsh and fish all read it as one word. */
export const shellEscapePath = (s: string) =>
  s.replaceAll(/[^\w./-]/gu, (ch) => `\\${ch}`)

/** What the session was started with; refuses anything else before it is typed or written. */
export const isCliSessionId = (s: string) => /^[0-9a-f-]{8,64}$/iu.test(s)

/**
 * The resume script: `/bin/sh` parses the quoting (the owner's interactive
 * shell may be fish, which reads `\'` inside single quotes differently).
 * Every word, the binary included, is quoted.
 */
export const resumeScript = (cwd: string, binPath: string, args: string[]) =>
  `#!/bin/sh\nrm -f -- "$0"\ncd ${shellQuote(cwd)} && exec ${[binPath, ...args].map((word) => shellQuote(word)).join(' ')}\n`

/** Actovia's own data, out of every agent's reach (assertWorkableFolder refuses it and its ancestors). */
export const terminalDir = () => join(getActoviaHome(), 'run', 'terminal')

async function assertPrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'EEXIST') throw e
  })
  const info = await lstat(dir)
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error(`Refusing to use ${dir}: not a plain directory`)
}

/** A fresh 0700 one-shot script; it deletes itself as its first command. */
export async function writeResumeScript(
  cwd: string,
  binPath: string,
  args: string[]
): Promise<string> {
  const dir = terminalDir()
  await mkdir(join(getActoviaHome(), 'run'), { recursive: true, mode: 0o700 })
  await assertPrivateDir(join(getActoviaHome(), 'run'))
  await assertPrivateDir(dir)
  const target = join(dir, `${randomUUID()}.sh`)
  const handle = await open(
    target,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o700
  )
  try {
    await handle.writeFile(resumeScript(cwd, binPath, args), 'utf8')
  } finally {
    await handle.close()
  }
  return target
}

/** At start: scripts Terminal never ran are not left lying around. */
export async function sweepResumeScripts(maxAgeMs = 3_600_000): Promise<void> {
  const dir = terminalDir()
  for (const d of [join(getActoviaHome(), 'run'), dir]) {
    const info = await lstat(d).catch(() => null)
    if (!info?.isDirectory() || info.isSymbolicLink()) return
  }
  const names = await readdir(dir).catch(() => [] as string[])
  for (const name of names) {
    const file = join(dir, name)
    const info = await lstat(file).catch(() => null)
    if (info?.isFile() && Date.now() - info.mtimeMs > maxAgeMs)
      await unlink(file).catch(() => {})
  }
}

/** Spec §5: the owner takes the session over by hand, in Terminal.app — running our script, no typed arguments. */
export function openInTerminal(scriptPath: string): Promise<void> {
  const script = `tell application "Terminal"
  activate
  do script ${appleScriptString(shellEscapePath(scriptPath))}
end tell`
  return new Promise((resolve, reject) =>
    execFile('osascript', ['-e', script], (err) =>
      err ? reject(err) : resolve()
    )
  )
}
