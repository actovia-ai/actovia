// Regenerate-group transitions (spec 2026-09-26 §2) on a real, in-memory
// PGlite with the shipped migrations through 0011, so the rows compared are
// the rows the app stores.
import { randomUUID } from 'crypto'

import { isAppError } from '@actovia/shared/errors/app-error'
import type { ChatMessage } from '@actovia/shared/types/chat'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/db/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite')
  const { createMigratedPglite } =
    await import('../../../helpers/migrated-pglite')
  const pglite = await createMigratedPglite('0011')
  return { pglite, db: drizzle(pglite) }
})

const { pglite } = await import('@main/lib/db/db')
const {
  applyAttempts,
  chooseAttempt,
  getChatAttempts,
  pickAutoChoice,
  recordRegenerate,
  settleOpenComparison
} = await import('@main/lib/chat/attempts')

afterAll(async () => {
  await pglite.close()
})

async function newChat(): Promise<string> {
  const id = randomUUID()
  await pglite.query(`INSERT INTO "chat" ("id","title") VALUES ($1,'t')`, [id])
  return id
}

let clock = Date.parse('2026-01-01T00:00:00Z')
/** A strictly later timestamp on every call. */
function tick(): Date {
  clock += 60_000
  return new Date(clock)
}

/**
 * A run: its user row (with `alternateOf` for a regenerate) and one answer
 * whose `stopReason` is given (`null` = no answer row at all).
 */
async function addRun(
  chatId: string,
  opts: { alternateOf?: string; stopReason?: string | null } = {}
): Promise<string> {
  const runId = randomUUID()
  await pglite.query(
    `INSERT INTO "message" ("id","chatId","runId","role","content","alternateOf","createdAt")
     VALUES ($1,$2,$1,'user','[]',$3,$4)`,
    [runId, chatId, opts.alternateOf ?? null, tick()]
  )
  const stopReason = opts.stopReason === undefined ? 'stop' : opts.stopReason
  if (stopReason !== null) {
    await pglite.query(
      `INSERT INTO "message" ("id","chatId","runId","role","content","stopReason","createdAt")
       VALUES ($1,$2,$3,'assistant','[]',$4,$5)`,
      [randomUUID(), chatId, runId, stopReason, tick()]
    )
  }
  return runId
}

/** A Regenerate of `group`, as the chat route does it: row, then transition. */
async function regenerate(
  chatId: string,
  group: string,
  stopReason?: string | null
): Promise<string> {
  const runId = await addRun(chatId, { alternateOf: group, stopReason })
  await recordRegenerate(chatId, runId, group)
  return runId
}

async function stateOf(
  chatId: string
): Promise<
  Record<string, { attempt: string | null; alternateOf: string | null }>
> {
  const { rows } = await pglite.query<{
    id: string
    role: string
    attempt: string | null
    alternateOf: string | null
  }>(
    `SELECT "id","role","attempt","alternateOf" FROM "message" WHERE "chatId" = $1`,
    [chatId]
  )
  const out: Record<
    string,
    { attempt: string | null; alternateOf: string | null }
  > = {}
  for (const r of rows) {
    if (r.role === 'user') {
      out[r.id] = { attempt: r.attempt, alternateOf: r.alternateOf }
    } else {
      // Never set on an assistant / toolResult row.
      expect(r.attempt).toBeNull()
      expect(r.alternateOf).toBeNull()
    }
  }
  return out
}

async function attemptsOf(chatId: string) {
  const state = await stateOf(chatId)
  return Object.fromEntries(
    Object.entries(state).map(([id, s]) => [id, s.attempt])
  )
}

async function expectCode(p: Promise<unknown>, code: string, status: number) {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  )
  expect(isAppError(err)).toBe(true)
  if (!isAppError(err)) return
  expect(err.code).toBe(code)
  expect(err.statusCode).toBe(status)
}

describe('recordRegenerate', () => {
  it('×1: the first run and the new one compare; the first run gets its attempt', async () => {
    const chat = await newChat()
    const before = await addRun(chat)
    const a = await addRun(chat)
    expect((await attemptsOf(chat))[a]).toBeNull()

    const b = await regenerate(chat, a)
    const state = await stateOf(chat)
    expect(state[a]).toEqual({ attempt: 'comparing', alternateOf: null })
    expect(state[b]).toEqual({ attempt: 'comparing', alternateOf: a })
    // A run outside the group is untouched.
    expect(state[before]).toEqual({ attempt: null, alternateOf: null })
  })

  it('×2: the newest two compare, the oldest is hidden', async () => {
    const chat = await newChat()
    const a = await addRun(chat)
    const b = await regenerate(chat, a)
    const c = await regenerate(chat, a)
    expect(await attemptsOf(chat)).toEqual({
      [a]: 'hidden',
      [b]: 'comparing',
      [c]: 'comparing'
    })
  })

  it('×3: every attempt older than the newest two is hidden', async () => {
    const chat = await newChat()
    const a = await addRun(chat)
    const b = await regenerate(chat, a)
    const c = await regenerate(chat, a)
    const d = await regenerate(chat, a)
    expect(await attemptsOf(chat)).toEqual({
      [a]: 'hidden',
      [b]: 'hidden',
      [c]: 'comparing',
      [d]: 'comparing'
    })
  })

  it('after a choice, compares the new run with the chosen one and hides the folded one', async () => {
    const chat = await newChat()
    const a = await addRun(chat)
    const b = await regenerate(chat, a)
    await chooseAttempt(chat, a) // a chosen, b folded
    const c = await regenerate(chat, a)
    expect(await attemptsOf(chat)).toEqual({
      [a]: 'comparing',
      [b]: 'hidden',
      [c]: 'comparing'
    })
  })

  it('resolves a group named by one of its later runs to the first run', async () => {
    const chat = await newChat()
    const a = await addRun(chat)
    const b = await regenerate(chat, a)
    const c = await regenerate(chat, b) // the client named b, not a
    const state = await stateOf(chat)
    expect(state[c]).toEqual({ attempt: 'comparing', alternateOf: a })
    expect(state[b].attempt).toBe('comparing')
    expect(state[a].attempt).toBe('hidden')
  })

  it('is idempotent', async () => {
    const chat = await newChat()
    const a = await addRun(chat)
    const b = await regenerate(chat, a)
    const once = await attemptsOf(chat)
    await recordRegenerate(chat, b, a)
    expect(await attemptsOf(chat)).toEqual(once)
  })

  it('404 RUN_NOT_FOUND for a group that is not in the chat', async () => {
    const chat = await newChat()
    const b = await addRun(chat)
    await expectCode(
      recordRegenerate(chat, b, randomUUID()),
      'RUN_NOT_FOUND',
      404
    )
  })
})

describe('chooseAttempt', () => {
  it('keeps the chosen run and folds the other', async () => {
    const chat = await newChat()
    const a = await addRun(chat)
    const b = await regenerate(chat, a)
    const result = await chooseAttempt(chat, a)
    expect(result).toEqual({ attempts: { [a]: 'chosen', [b]: 'folded' } })
    expect(await attemptsOf(chat)).toEqual({ [a]: 'chosen', [b]: 'folded' })
  })

  it('leaves hidden attempts hidden', async () => {
    const chat = await newChat()
    const a = await addRun(chat)
    const b = await regenerate(chat, a)
    const c = await regenerate(chat, a)
    const result = await chooseAttempt(chat, c)
    expect(result.attempts).toEqual({
      [a]: 'hidden',
      [b]: 'folded',
      [c]: 'chosen'
    })
  })

  it('swaps while the group is the last exchange', async () => {
    const chat = await newChat()
    const a = await addRun(chat)
    const b = await regenerate(chat, a)
    await chooseAttempt(chat, b)
    const swapped = await chooseAttempt(chat, a)
    expect(swapped.attempts).toEqual({ [a]: 'chosen', [b]: 'folded' })
  })

  it('409 ATTEMPT_LOCKED once a later run exists; the chosen one still answers', async () => {
    const chat = await newChat()
    const a = await addRun(chat)
    const b = await regenerate(chat, a)
    await chooseAttempt(chat, b)
    await settleOpenComparison(chat)
    await addRun(chat) // the conversation moves on

    await expectCode(chooseAttempt(chat, a), 'ATTEMPT_LOCKED', 409)
    expect(await chooseAttempt(chat, b)).toEqual({
      attempts: { [a]: 'folded', [b]: 'chosen' }
    })
  })

  it('is idempotent (a double click)', async () => {
    const chat = await newChat()
    const a = await addRun(chat)
    const b = await regenerate(chat, a)
    const [first, second] = await Promise.all([
      chooseAttempt(chat, b),
      chooseAttempt(chat, b)
    ])
    expect(first).toEqual(second)
    expect(await attemptsOf(chat)).toEqual({ [a]: 'folded', [b]: 'chosen' })
  })

  it('404 RUN_NOT_FOUND for an unknown run, another chat’s run, or an ordinary run', async () => {
    const chat = await newChat()
    const other = await newChat()
    const a = await addRun(chat)
    await regenerate(chat, a)
    const plain = await addRun(chat)
    const elsewhere = await addRun(other)

    await expectCode(chooseAttempt(chat, randomUUID()), 'RUN_NOT_FOUND', 404)
    await expectCode(chooseAttempt(chat, elsewhere), 'RUN_NOT_FOUND', 404)
    await expectCode(chooseAttempt(chat, plain), 'RUN_NOT_FOUND', 404)
  })

  it('409 for a hidden attempt', async () => {
    const chat = await newChat()
    const a = await addRun(chat)
    await regenerate(chat, a)
    await regenerate(chat, a)
    await expectCode(chooseAttempt(chat, a), 'ATTEMPT_LOCKED', 409)
  })
})

describe('settleOpenComparison', () => {
  it('chooses the newer answer and folds the older', async () => {
    const chat = await newChat()
    const a = await addRun(chat)
    const b = await regenerate(chat, a)
    await settleOpenComparison(chat)
    expect(await attemptsOf(chat)).toEqual({ [a]: 'folded', [b]: 'chosen' })
  })

  it.each([
    ['error', 'error'],
    ['aborted', 'aborted'],
    ['no answer row', null]
  ])(
    'prefers the older answer when the newer one failed (%s)',
    async (_label, stopReason) => {
      const chat = await newChat()
      const a = await addRun(chat)
      const b = await regenerate(chat, a, stopReason)
      await settleOpenComparison(chat)
      expect(await attemptsOf(chat)).toEqual({ [a]: 'chosen', [b]: 'folded' })
    }
  )

  it('judges a run by its last answer row', async () => {
    const chat = await newChat()
    const a = await addRun(chat)
    const b = await regenerate(chat, a, 'toolUse')
    // b's final step failed after a successful tool step.
    await pglite.query(
      `INSERT INTO "message" ("id","chatId","runId","role","content","stopReason","createdAt")
       VALUES ($1,$2,$3,'assistant','[]','error',$4)`,
      [randomUUID(), chat, b, tick()]
    )
    await settleOpenComparison(chat)
    expect(await attemptsOf(chat)).toEqual({ [a]: 'chosen', [b]: 'folded' })
  })

  it('is a no-op with nothing open, and when repeated', async () => {
    const chat = await newChat()
    const a = await addRun(chat)
    await settleOpenComparison(chat)
    expect(await attemptsOf(chat)).toEqual({ [a]: null })

    const b = await regenerate(chat, a)
    await chooseAttempt(chat, a)
    await settleOpenComparison(chat)
    await settleOpenComparison(chat)
    expect(await attemptsOf(chat)).toEqual({ [a]: 'chosen', [b]: 'folded' })
  })
})

describe('pickAutoChoice', () => {
  const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m))

  it('prefers the newer answer', () => {
    expect(
      pickAutoChoice([
        { runId: 'old', createdAt: t(0), failed: false },
        { runId: 'new', createdAt: t(1), failed: false }
      ])
    ).toBe('new')
  })

  it('prefers the newer answer that did not fail, whatever the input order', () => {
    expect(
      pickAutoChoice([
        { runId: 'new', createdAt: t(1), failed: true },
        { runId: 'old', createdAt: t(0), failed: false }
      ])
    ).toBe('old')
  })

  it('falls back to the older when both failed', () => {
    expect(
      pickAutoChoice([
        { runId: 'old', createdAt: t(0), failed: true },
        { runId: 'new', createdAt: t(1), failed: true }
      ])
    ).toBe('old')
  })

  it('throws on nothing to choose from', () => {
    expect(() => pickAutoChoice([])).toThrow()
  })
})

describe('getChatAttempts / applyAttempts', () => {
  it('reads the stored state and lays it over echoed messages', async () => {
    const chat = await newChat()
    const a = await addRun(chat)
    const b = await regenerate(chat, a)
    const attempts = await getChatAttempts(chat)
    expect(attempts).toEqual({ [a]: 'comparing', [b]: 'comparing' })

    const reply = {
      id: 'x',
      runId: a,
      role: 'assistant'
    } as unknown as ChatMessage
    const messages = [
      { id: a, runId: a, role: 'user', content: 'q', timestamp: 0 },
      reply,
      {
        id: b,
        runId: b,
        role: 'user',
        content: 'q',
        timestamp: 0,
        attempt: 'comparing'
      }
    ] as ChatMessage[]
    const out = applyAttempts(messages, attempts)
    expect(out[0]).toMatchObject({ attempt: 'comparing' })
    expect(out[1]).toBe(reply)
    // Unchanged: the same object.
    expect(out[2]).toBe(messages[2])
  })
})
