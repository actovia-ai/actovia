// src/main/lib/agents/cli-check.ts
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { access, constants, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import type { CliId, CliStatus } from '@exodus/shared/types/agents'

import { loginShellEnv } from './login-shell'
import { superviseProcess } from './process'
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
  /** The CLI's models, asked without spending quota; null when unknown. */
  listModels(
    id: CliId,
    path: string,
    env: Record<string, string>
  ): Promise<string[] | null>
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

/** Codex' phrases after "Logged in using ", as the CLI's 0.162.1 binary has them. */
const CODEX_AUTH_LABELS = [
  'API key',
  'ChatGPT',
  'personal access token',
  'access token',
  'workload identity',
  'Amazon Bedrock'
]

/**
 * How Codex is logged in, as a fixed label: the CLI's own line can carry part
 * of a key ("Logged in using an API key - sk-proj-***ABCDE"), which must never
 * reach the status, the UI or the phone.
 */
function codexAuthMethod(out: string): string | null {
  const rest = out.match(/Logged in using ([^\n]*)/u)?.[1]
  if (rest === undefined) return null
  const phrase = rest
    .split(' - ')[0]
    .trim()
    .replace(/^(?:an|a) /iu, '')
    .trim()
  const known = CODEX_AUTH_LABELS.find((label) =>
    phrase.toLowerCase().startsWith(label.toLowerCase())
  )
  if (known) return known
  const cleaned = phrase
    .replaceAll(/[^\p{L}\p{N} -]/gu, '')
    .slice(0, 40)
    .trim()
  return cleaned || null
}

/** `codex login status`: "Logged in using ChatGPT" (exit 0), "Not logged in" (exit 1). */
export function parseCodexLoginStatus(
  code: number,
  out: string
): { loggedIn: boolean; authMethod: string | null } {
  const loggedIn = code === 0 && /Logged in/u.test(out)
  return { loggedIn, authMethod: loggedIn ? codexAuthMethod(out) : null }
}

const MODEL_LIST_TIMEOUT_MS = 5000
const MAX_MODELS = 200

/** A name Exodus may put on the CLI's command line (as the employee editor's rule). */
const isCliModelName = (m: string) =>
  /^[\w.:[\]-]+$/u.test(m) && !m.startsWith('-')

/**
 * Codex' models, from a short-lived `codex app-server` (`model/list` spends no
 * quota) run outside any project folder. The process always ends: on the
 * answer, a failure or the timeout; any of the latter two gives null.
 */
export function listCodexModels(
  path: string,
  env: Record<string, string>,
  timeoutMs = MODEL_LIST_TIMEOUT_MS
): Promise<string[] | null> {
  const logPath = join(tmpdir(), `exodus-codex-models-${randomUUID()}.log`)
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (models: string[] | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void proc.stop().then(() => unlink(logPath).catch(() => {}))
      resolve(models)
    }
    const proc = superviseProcess({
      binPath: path,
      args: ['app-server'],
      cwd: tmpdir(),
      env,
      logPath,
      onLine(line) {
        let m: { id?: unknown; result?: unknown; error?: unknown }
        try {
          m = JSON.parse(line)
        } catch {
          return
        }
        if (m?.id === 1) {
          if (m.error) return finish(null)
          proc.write({ method: 'initialized' })
          proc.write({ id: 2, method: 'model/list', params: {} })
        } else if (m?.id === 2) {
          const data = (m.result as { data?: unknown } | undefined)?.data
          if (m.error || !Array.isArray(data)) return finish(null)
          // Only the first page: the server returns every model in one today.
          const names = (data as Array<Record<string, unknown>>)
            .filter((e) => e && e.hidden !== true)
            .map((e) =>
              typeof e.model === 'string'
                ? e.model
                : typeof e.id === 'string'
                  ? e.id
                  : ''
            )
            .filter((name) => isCliModelName(name))
          finish([...new Set(names)].slice(0, MAX_MODELS))
        }
      },
      onExit() {
        finish(null)
      }
    })
    timer = setTimeout(() => finish(null), timeoutMs)
    proc.write({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'exodus', title: 'Exodus', version: '1' },
        capabilities: null
      }
    })
  })
}

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
    }),
  listModels: (id, path, env) =>
    id === 'codex' ? listCodexModels(path, env) : Promise.resolve(null)
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

  const a = await deps.exec(
    path,
    id === 'codex' ? ['login', 'status'] : ['auth', 'status'],
    env
  )
  let auth: { loggedIn?: boolean; authMethod?: string | null } = {}
  if (id === 'codex') {
    // Codex 0.162.1 prints its status on stderr.
    auth = parseCodexLoginStatus(a.code, `${a.stdout}\n${a.stderr}`)
  } else {
    try {
      auth = JSON.parse(a.stdout.slice(a.stdout.indexOf('{')))
    } catch {
      // not JSON: treated as logged out, with the CLI's words
    }
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
    authMethod: auth.authMethod ?? null,
    models: await deps.listModels(id, path, env).catch(() => null)
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
