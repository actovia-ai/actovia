// src/main/lib/agents/login-shell.ts
import { execFile } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'

import { logger } from '../logger'

const MARK = '__ACTOVIA_ENV__'
const DROP = /^(ACTOVIA_|ELECTRON_|VITE_)/
/** Where CLIs install when the login shell cannot tell us (spec §3). */
const FALLBACK_DIRS = [
  join(homedir(), '.local/bin'),
  join(homedir(), '.claude/local'),
  '/opt/homebrew/bin',
  '/usr/local/bin'
]

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

/** The child never sees Actovia' own variables (spec §7.4). */
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
      (err, stdout) => {
        const env = parseEnvDump(String(stdout ?? ''))
        if (env.PATH) return resolve(scrubEnv(env))
        logger.warn('agents', 'login shell gave no PATH; using fallbacks', {
          err: err?.message
        })
        resolve(
          scrubEnv({
            ...process.env,
            PATH: [process.env.PATH, ...FALLBACK_DIRS].filter(Boolean).join(':')
          })
        )
      }
    )
  })
  return cached
}

/** Settings' Check button: read the shell again (the owner may have just installed). */
export function resetLoginShellEnv(): void {
  cached = null
}
