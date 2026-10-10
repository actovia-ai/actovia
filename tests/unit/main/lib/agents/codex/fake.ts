// tests/unit/main/lib/agents/codex/fake.ts — drives startCodex against the fake app-server
import { chmodSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { startCodex } from '@main/lib/agents/codex/run'
import type { AgentEvent, AgentRun } from '@main/lib/agents/driver'

const FIX = resolve(import.meta.dirname, '../../../../../fixtures/codex')
const FAKE = join(FIX, 'fake-codex.mjs')
/** The thread in the fixtures. */
export const THREAD = '01a1245d-2907-72f3-9b06-3dc67f153940'
/** The JSON-RPC id behind a prompt's `${nonce}:${rpcId}` request id. */
export const rpcIdOf = (requestId: string) => Number(requestId.split(':')[1])
export const prepareFake = () => chmodSync(FAKE, 0o755)

export function start(
  fixture: string,
  extra: Record<string, string> = {},
  input: Partial<Parameters<typeof startCodex>[0]> = {}
) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-run-'))
  const recordPath = join(dir, 'record.jsonl')
  const logPath = join(dir, 'raw.jsonl')
  const run = startCodex({
    binPath: FAKE,
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? '',
      FAKE_CODEX_FIXTURE: join(FIX, fixture),
      FAKE_CODEX_RECORD: recordPath,
      ...extra
    },
    permissionMode: 'default',
    logPath,
    ...input
  })
  const events: AgentEvent[] = []
  run.on((e) => events.push(e))
  const recorded = () =>
    readFileSync(recordPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((r) => r.stdin)
      .map((r) => r.stdin)
  return { run, events, recorded, logPath }
}

export function next(
  run: AgentRun,
  match: (e: AgentEvent) => boolean,
  ms = 5000
): Promise<AgentEvent> {
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('timed out')), ms)
    const off = run.on((e) => {
      if (match(e)) {
        clearTimeout(timer)
        off()
        ok(e)
      }
    })
  })
}
export const blocked = (run: AgentRun) =>
  next(run, (e) => e.type === 'blocked') as Promise<
    Extract<AgentEvent, { type: 'blocked' }>
  >
