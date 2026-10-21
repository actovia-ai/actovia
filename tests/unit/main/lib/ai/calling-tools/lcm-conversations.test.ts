import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The recall tools read a conversation: the one they are bound to, or another
// the user named by its id (copied from the sidebar). Real SQL on an in-memory
// PGlite, as the context assembler's tests.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false }
}))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/db/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite')
  const { createMigratedPglite } =
    await import('../../../../helpers/migrated-pglite')
  const pglite = await createMigratedPglite('9999')
  return { pglite, db: drizzle(pglite) }
})

const completeSimple = vi.fn()
vi.mock('@main/lib/ai/kernel/models', () => ({
  getKernelModels: () => ({ completeSimple })
}))

const { pglite } = await import('@main/lib/db/db')
const { lcmGrep } = await import('@main/lib/ai/calling-tools/lcm-grep')
const { lcmDescribe } = await import('@main/lib/ai/calling-tools/lcm-describe')
const { lcmExpand } = await import('@main/lib/ai/calling-tools/lcm-expand')

afterAll(async () => {
  await pglite.close()
})

beforeEach(() => {
  completeSimple.mockReset()
})

const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString()
const q = (v: unknown) =>
  v === null || v === undefined
    ? 'NULL'
    : `'${(typeof v === 'string' ? v : JSON.stringify(v)).replaceAll("'", "''")}'`

type Row = {
  role: 'user' | 'assistant' | 'toolResult'
  text: string
  /** Starts a run; the rows after it belong to it. */
  attempt?: 'comparing' | 'chosen' | 'folded' | 'hidden'
}

let clock = 0

/** A chat with the rows given, oldest first. */
async function seedChat(title: string, rows: Row[]) {
  const chatId = crypto.randomUUID()
  await pglite.exec(
    `INSERT INTO "chat" ("id","title") VALUES ('${chatId}',${q(title)})`
  )
  const ids: string[] = []
  const values: string[] = []
  let runId = ''
  for (const row of rows) {
    const id = crypto.randomUUID()
    if (row.role === 'user') runId = id
    ids.push(id)
    values.push(
      `('${id}','${chatId}','${runId}','${row.role}',${q(JSON.stringify([{ type: 'text', text: row.text }]))},${q(row.attempt)},'${at(clock++)}')`
    )
  }
  if (values.length > 0) {
    await pglite.exec(
      `INSERT INTO "message" ("id","chatId","runId","role","content","attempt","createdAt") VALUES ${values.join(',')}`
    )
  }
  return { chatId, ids }
}

/** A summary of the chat, first in its context; `covers` leave the context. */
async function seedSummary(
  chatId: string,
  id: string,
  content: string,
  rest: string[]
) {
  await pglite.exec(
    `INSERT INTO "lcm_summary" ("id","chatId","kind","depth","content","tokenCount","earliestAt","latestAt") VALUES ('${id}','${chatId}','leaf',0,${q(content)},10,'${at(0)}','${at(1)}')`
  )
  const items = [
    `('${chatId}',0,'summary','${id}',10)`,
    ...rest.map((ref, i) => `('${chatId}',${i + 1},'message','${ref}',5)`)
  ]
  await pglite.exec(
    `INSERT INTO "lcm_context_items" ("chatId","ordinal","kind","refId","tokenCount") VALUES ${items.join(',')}`
  )
}

const textOf = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content.map((block) => block.text ?? '').join('')

describe('lcm_grep', () => {
  it('searches the conversation it is bound to when no id is given', async () => {
    const here = await seedChat('Here', [
      { role: 'user', text: 'the budget is 4200 euros' }
    ])
    await seedChat('Elsewhere', [
      { role: 'user', text: 'the budget is 9900 euros' }
    ])

    const result = await lcmGrep(here.chatId).execute('call', {
      pattern: 'budget'
    })

    expect(textOf(result)).toContain('4200')
    expect(textOf(result)).not.toContain('9900')
  })

  it('searches another conversation when the user named it by id', async () => {
    const here = await seedChat('Here', [
      { role: 'user', text: 'nothing about money' }
    ])
    const other = await seedChat('Trip planning', [
      { role: 'user', text: 'the budget is 9900 euros' }
    ])

    const result = await lcmGrep(here.chatId).execute('call', {
      chatId: other.chatId,
      pattern: 'budget'
    })

    expect(textOf(result)).toContain('9900')
  })

  it('answers, and asks the database nothing, for an id that is not one', async () => {
    const here = await seedChat('Here', [{ role: 'user', text: 'hello' }])

    const result = await lcmGrep(here.chatId).execute('call', {
      chatId: 'the trip chat',
      pattern: 'budget'
    })

    expect(textOf(result)).toMatch(/not a conversation id/i)
    expect(result.details).toEqual([])
  })

  it('says so when no conversation has that id', async () => {
    const here = await seedChat('Here', [{ role: 'user', text: 'hello' }])
    const missing = crypto.randomUUID()

    const result = await lcmGrep(here.chatId).execute('call', {
      chatId: missing,
      pattern: 'budget'
    })

    expect(textOf(result)).toMatch(/no conversation/i)
    expect(textOf(result)).toContain(missing)
  })

  it('asks for an id when it is bound to no conversation', async () => {
    const result = await lcmGrep().execute('call', { pattern: 'budget' })

    expect(textOf(result)).toMatch(/conversation id/i)
    expect(result.details).toEqual([])
  })
})

describe('lcm_expand', () => {
  it('reads the conversation it is bound to when no id is given', async () => {
    const here = await seedChat('Here', [{ role: 'user', text: 'later' }])
    await seedSummary(
      here.chatId,
      'sum_here000000000001',
      'The launch moved to March.',
      here.ids
    )
    completeSimple.mockResolvedValue({
      stopReason: 'stop',
      content: [{ type: 'text', text: 'March.' }]
    })

    const tool = lcmExpand({ id: 'm' } as never, 'key', here.chatId)
    const result = await tool.execute('call', { query: 'launch' })

    expect(textOf(result)).toBe('March.')
    const [, context] = completeSimple.mock.calls[0]
    expect(JSON.stringify(context)).toContain('The launch moved to March.')
  })
})

describe('lcm_describe', () => {
  it('still reads a summary by its id', async () => {
    const here = await seedChat('Here', [{ role: 'user', text: 'later' }])
    await seedSummary(
      here.chatId,
      'sum_here000000000002',
      'A summary to read.',
      here.ids
    )

    const result = await lcmDescribe.execute('call', {
      id: 'sum_here000000000002'
    })

    expect(textOf(result)).toContain('A summary to read.')
  })

  it('reads a conversation by its id: what it was about, oldest first', async () => {
    const other = await seedChat('Trip planning', [
      { role: 'user', text: 'Where should we stay in Kyoto?' },
      { role: 'assistant', text: 'Near Gion, for the evenings.' },
      { role: 'toolResult', text: 'RAW SEARCH DUMP' },
      { role: 'user', text: 'And the budget?' },
      { role: 'assistant', text: 'About 9900 euros for two.' }
    ])
    await seedSummary(
      other.chatId,
      'sum_other00000000001',
      'They chose Kyoto over Osaka.',
      other.ids
    )

    const result = await lcmDescribe.execute('call', { id: other.chatId })
    const details = result.details as {
      conversation: { id: string; title: string }
      summaries: Array<{ id: string; content: string }>
      messages: Array<{ role: string; text: string }>
    }

    expect(details.conversation).toMatchObject({
      id: other.chatId,
      title: 'Trip planning'
    })
    expect(details.summaries.map((s) => s.content)).toEqual([
      'They chose Kyoto over Osaka.'
    ])
    expect(details.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Where should we stay in Kyoto?'],
      ['assistant', 'Near Gion, for the evenings.'],
      ['user', 'And the budget?'],
      ['assistant', 'About 9900 euros for two.']
    ])
    expect(textOf(result)).toContain('They chose Kyoto over Osaka.')
    expect(textOf(result)).not.toContain('RAW SEARCH DUMP')
  })

  it('reads a conversation that was never compacted from its messages', async () => {
    const other = await seedChat('Short one', [
      { role: 'user', text: 'Remind me of the wifi password rule.' },
      { role: 'assistant', text: 'Twelve characters, rotated yearly.' }
    ])

    const result = await lcmDescribe.execute('call', { id: other.chatId })
    const details = result.details as {
      summaries: unknown[]
      messages: Array<{ text: string }>
    }

    expect(details.summaries).toEqual([])
    expect(details.messages.map((m) => m.text)).toEqual([
      'Remind me of the wifi password rule.',
      'Twelve characters, rotated yearly.'
    ])
  })

  it('leaves out the answers a regenerate group keeps out of sight', async () => {
    const other = await seedChat('Regenerated', [
      { role: 'user', text: 'first try', attempt: 'folded' },
      { role: 'assistant', text: 'the answer not kept' },
      { role: 'user', text: 'second try', attempt: 'chosen' },
      { role: 'assistant', text: 'the answer kept' }
    ])

    const result = await lcmDescribe.execute('call', { id: other.chatId })

    expect(textOf(result)).toContain('the answer kept')
    expect(textOf(result)).not.toContain('the answer not kept')
  })

  it('cuts a long message and says what it left out', async () => {
    const long = 'x'.repeat(5000)
    const many: Row[] = []
    for (let i = 0; i < 40; i++) {
      many.push({ role: 'user', text: `question ${i} ${long}` })
      many.push({ role: 'assistant', text: `answer ${i}` })
    }
    const other = await seedChat('Long one', many)

    const result = await lcmDescribe.execute('call', { id: other.chatId })
    const details = result.details as {
      messages: Array<{ text: string; truncated?: boolean }>
      omitted: { messages: number }
    }

    expect(textOf(result).length).toBeLessThan(30_000)
    expect(details.messages.at(-1)?.text).toBe('answer 39')
    expect(details.messages.some((m) => m.truncated)).toBe(true)
    expect(details.omitted.messages).toBeGreaterThan(0)
  })

  it('says so when no conversation has that id', async () => {
    const missing = crypto.randomUUID()

    const result = await lcmDescribe.execute('call', { id: missing })

    expect(textOf(result)).toMatch(/no conversation/i)
    expect(result.details).toBeNull()
  })
})
