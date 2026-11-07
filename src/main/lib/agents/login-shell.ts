// src/main/lib/agents/login-shell.ts
import { execFile } from 'child_process'
import { readdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

import { logger } from '../logger'

const MARK = '__ACTOVIA_ENV__'
const DROP = /^(ACTOVIA_|ELECTRON_|VITE_)/
/** Keep the selected shell tools first, then look for CLIs installed elsewhere.
 * npm globals belong to a Node version: switching nvm's default must not make
 * an otherwise working Codex installation disappear from the app's PATH. */
export async function withCliFallbacks(
  env: Record<string, string>,
  home = homedir()
): Promise<Record<string, string>> {
  const nvmVersions = join(env.NVM_DIR || join(home, '.nvm'), 'versions/node')
  const versions = await readdir(nvmVersions, { withFileTypes: true }).catch(
    () => []
  )
  const nvmBins = versions
    .filter(
      (entry) => entry.isDirectory() && /^v\d+\.\d+\.\d+$/u.test(entry.name)
    )
    .toSorted((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }))
    .map((entry) => join(nvmVersions, entry.name, 'bin'))
  return {
    ...env,
    PATH: [
      ...new Set([
        ...(env.PATH ?? '').split(':').filter(Boolean),
        join(home, '.local/bin'),
        join(home, '.claude/local'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        ...nvmBins
      ])
    ].join(':')
  }
}

export function parseEnvDump(out: string): Record<string, string> {
  const start = out.indexOf(MARK)
  const end = out.lastIndexOf(MARK)
  if (start < 0 || end <= start) return {}
  const env: Record<string, string> = {}
  for (const entry of out.slice(start + MARK.length, end).split('\0')) {
    const i = entry.indexOf('=')
    if (i > 0) env[entry.slice(0, i)] = entry.slice(i + 1)
  }
  return env
}

/** The child never sees Actovia's own variables (spec §7.4). */
export function scrubEnv(
  env: Record<string, string | undefined>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || DROP.test(key) || key === 'NODE_OPTIONS')
      continue
    out[key] = value
  }
  return out
}

let cached: Promise<Record<string, string>> | null = null

/**
 * The owner's login-shell environment, once per app run: an app opened from
 * Finder has launchd's PATH and would not find `~/.local/bin`, Homebrew or
 * nvm. `-i` too, since nvm and friends hook in from `.zshrc`.
 */
export function loginShellEnv(): Promise<Record<string, string>> {
  cached ??= new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh'
    execFile(
      shell,
      ['-lic', `printf '${MARK}'; env -0; printf '${MARK}'`],
      {
        timeout: 8000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          HOME: homedir(),
          USER: process.env.USER ?? '',
          SHELL: shell,
          TERM: 'dumb'
        }
      },
      async (err, stdout) => {
        const env = parseEnvDump(String(stdout ?? ''))
        if (env.PATH) return resolve(scrubEnv(await withCliFallbacks(env)))
        logger.warn('agents', 'login shell gave no PATH; using fallbacks', {
          err: err?.message
        })
        resolve(scrubEnv(await withCliFallbacks(scrubEnv(process.env))))
      }
    )
  })
  return cached
}

/** Settings' Check button: read the shell again (the owner may have just installed). */
export function resetLoginShellEnv(): void {
  cached = null
}
