// src/main/lib/agents/cli-check.ts
import { execFile } from 'child_process'
import { access, constants } from 'fs/promises'
import { join } from 'path'

import type { CliId, CliStatus } from '@exodus/shared/types/agents'

import { loginShellEnv } from './login-shell'
import { agentSettings } from './settings'

export const CLI_BINARY: Record<CliId, string> = {
  'claude-code': 'claude',
  codex: 'codex'
}
/** The version the driver was verified against (probes, 2026-10-09). */
export const MIN_VERSION: Record<CliId, string> = {
  'claude-code': '2.1.294',
  codex: '0.162.1'
}

export interface CheckDeps {
  env(): Promise<Record<string, string>>
  overridePath(id: CliId): Promise<string | null>
  exec(
    file: string,
    args: string[],
    env: Record<string, string>
  ): Promise<{ code: number; stdout: string; stderr: string }>
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export async function findOnPath(
  name: string,
  path: string
): Promise<string | null> {
  for (const dir of path.split(':').filter(Boolean)) {
    const file = join(dir, name)
    try {
      await access(file, constants.X_OK)
      return file
    } catch {
      // not here
    }
  }
  return null
}

const tail = (s: string, n = 600) =>
  (s.length > n ? '…' + s.slice(-n) : s).trim()

const defaultDeps: CheckDeps = {
  env: loginShellEnv,
  overridePath: async (id) => (await agentSettings()).cliPaths[id] || null,
  exec: (file, args, env) =>
    new Promise((resolve) => {
      execFile(
        file,
        args,
        { env, timeout: 15_000, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0
          resolve({
            code,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? '') || (err && !stdout ? err.message : '')
          })
        }
      )
    })
}

/** Found · runs · new enough · logged in (spec §3). Spends no quota. */
export async function checkCli(
  id: CliId,
  deps: CheckDeps = defaultDeps
): Promise<CliStatus> {
  const base = {
    id,
    path: null,
    version: null,
    authMethod: null,
    detail: null,
    models: null,
    checkedAt: Date.now()
  }
  const env = await deps.env()
  const path =
    (await deps.overridePath(id)) ??
    (await findOnPath(CLI_BINARY[id], env.PATH ?? ''))
  if (!path) return { ...base, state: 'not_installed' }

  const v = await deps.exec(path, ['--version'], env)
  const version =
    v.code === 0 ? (v.stdout.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null) : null
  if (!version)
    return {
      ...base,
      path,
      state: 'broken',
      detail: tail(v.stderr || v.stdout)
    }
  if (compareVersions(version, MIN_VERSION[id]) < 0)
    return { ...base, path, version, state: 'too_old' }

  const a = await deps.exec(path, ['auth', 'status'], env)
  let auth: { loggedIn?: boolean; authMethod?: string } = {}
  try {
    auth = JSON.parse(a.stdout.slice(a.stdout.indexOf('{')))
  } catch {
    // not JSON: treated as logged out, with the CLI's words
  }
  if (auth.loggedIn !== true) {
    return {
      ...base,
      path,
      version,
      state: 'logged_out',
      detail: tail(a.stderr || a.stdout) || null
    }
  }
  return {
    ...base,
    path,
    version,
    state: 'ready',
    authMethod: auth.authMethod ?? null
  }
}

const cache = new Map<CliId, Promise<CliStatus>>()

/** Cached for the app's life; a failed check is re-run next time (spec §3). */
export function getCliStatus(
  id: CliId,
  opts: { refresh?: boolean } = {}
): Promise<CliStatus> {
  const hit = cache.get(id)
  if (hit && !opts.refresh) {
    return hit.then((s) =>
      s.state === 'ready' ? s : getCliStatus(id, { refresh: true })
    )
  }
  const next = checkCli(id)
  cache.set(id, next)
  return next
}
