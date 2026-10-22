import { afterAll, describe, expect, it, vi } from 'vitest'

// A Deep Research call returns the job's id at once; the report lands in
// `deep_research` minutes later. It must reach the chat's stored tool result,
// or nothing that reads the conversation (a follow-up, recall, lcm_grep,
// another chat's lcm_describe) ever sees it. Real SQL on an in-memory PGlite.
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
vi.mock('@main/lib/ai/kernel/models', () => ({
  getKernelModels: () => ({ completeSimple: vi.fn() })
}))

const { pglite } = await import('@main/lib/db/db')
const {
  deepResearchResultText,
  settleDeepResearchResult,
  settleDeepResearchResults
} = await import('@main/lib/ai/deep-research/chat-result')
const { lcmDescribe } = await import('@main/lib/ai/calling-tools/lcm-describe')

afterAll(async () => {
  await pglite.close()
})

const q = (v: string) => `'${v.replaceAll("'", "''")}'`
let clock = 0
const at = () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString()

/** A chat whose one run called deep_research; the result holds the job id. */
async function seedChat(jobId: string, toolCallId: string) {
  const chatId = crypto.randomUUID()
  const runId = crypto.randomUUID()
  const resultId = crypto.randomUUID()
  await pglite.exec(
    `INSERT INTO "chat" ("id","title") VALUES ('${chatId}','Heat pumps')`
  )
  const placeholder = JSON.stringify({ id: jobId, toolCallId })
  await pglite.exec(`INSERT INTO "message" ("id","chatId","runId","role","content","createdAt") VALUES
    ('${runId}','${chatId}','${runId}','user',${q(JSON.stringify([{ type: 'text', text: 'Research heat pump funding.' }]))},'${at()}'),
    ('${crypto.randomUUID()}','${chatId}','${runId}','assistant',${q(JSON.stringify([{ type: 'toolCall', id: toolCallId, name: 'deep_research', arguments: { subject: 'Heat pumps' } }]))},'${at()}')`)
  await pglite.exec(`INSERT INTO "message" ("id","chatId","runId","role","content","toolCallId","toolName","details","isError","createdAt") VALUES
    ('${resultId}','${chatId}','${runId}','toolResult',${q(JSON.stringify([{ type: 'text', text: placeholder }]))},'${toolCallId}','deep_research',${q(JSON.stringify({ id: jobId, toolCallId }))},false,'${at()}')`)
  return { chatId, resultId }
}

async function seedJob(
  toolCallId: string,
  status: 'streaming' | 'archived' | 'failed',
  extra: { finalReport?: string; errorMessage?: string } = {}
) {
  const id = crypto.randomUUID()
  await pglite.exec(
    `INSERT INTO "deep_research" ("id","toolCallId","title","jobStatus","finalReport","errorMessage") VALUES ('${id}','${toolCallId}','Heat pumps','${status}',${extra.finalReport ? q(extra.finalReport) : 'NULL'},${extra.errorMessage ? q(extra.errorMessage) : 'NULL'})`
  )
  return id
}

async function resultText(resultId: string): Promise<string> {
  const { rows } = await pglite.query<{ content: Array<{ text: string }> }>(
    `SELECT "content" FROM "message" WHERE "id" = '${resultId}'`
  )
  return rows[0].content[0].text
}

describe('deepResearchResultText', () => {
  it('is the report once the job is archived, the reason once it failed', () => {
    expect(
      deepResearchResultText({
        title: 'Heat pumps',
        jobStatus: 'archived',
        finalReport: '# Report',
        errorMessage: null
      })
    ).toBe('Deep research finished: Heat pumps\n\n# Report')
    expect(
      deepResearchResultText({
        title: 'Heat pumps',
        jobStatus: 'failed',
        finalReport: null,
        errorMessage: 'No Brave key'
      })
    ).toBe('Deep research failed: Heat pumps\n\nNo Brave key')
  })

  it('is null while the job runs', () => {
    expect(
      deepResearchResultText({
        title: 'Heat pumps',
        jobStatus: 'streaming',
        finalReport: null,
        errorMessage: null
      })
    ).toBeNull()
  })
})

describe('settling a chat’s deep_research result', () => {
  it('writes the report into the stored result when the job ends', async () => {
    const toolCallId = `toolu_${crypto.randomUUID()}`
    const jobId = await seedJob(toolCallId, 'archived', {
      finalReport: '# Germany\nLandlords pass on 8% a year, capped.'
    })
    const { resultId } = await seedChat(jobId, toolCallId)

    await settleDeepResearchResult(jobId)

    expect(await resultText(resultId)).toBe(
      'Deep research finished: Heat pumps\n\n# Germany\nLandlords pass on 8% a year, capped.'
    )
  })

  it('leaves a running job’s result as it is', async () => {
    const toolCallId = `toolu_${crypto.randomUUID()}`
    const jobId = await seedJob(toolCallId, 'streaming')
    const { resultId } = await seedChat(jobId, toolCallId)

    await settleDeepResearchResult(jobId)

    expect(JSON.parse(await resultText(resultId))).toEqual({
      id: jobId,
      toolCallId
    })
  })

  it('catches up a result saved after its job ended, once', async () => {
    const toolCallId = `toolu_${crypto.randomUUID()}`
    const jobId = await seedJob(toolCallId, 'failed', {
      errorMessage: 'No Brave key'
    })
    // The job ended first: no row to write to yet.
    await settleDeepResearchResult(jobId)
    const { resultId } = await seedChat(jobId, toolCallId)

    expect(await settleDeepResearchResults()).toBeGreaterThanOrEqual(1)
    expect(await resultText(resultId)).toBe(
      'Deep research failed: Heat pumps\n\nNo Brave key'
    )
    expect(await settleDeepResearchResults()).toBe(0)
  })

  it('lets another conversation’s lcm_describe read the report', async () => {
    const toolCallId = `toolu_${crypto.randomUUID()}`
    const jobId = await seedJob(toolCallId, 'archived', {
      finalReport: 'Tenants pay at most 8% of the cost a year.'
    })
    const { chatId } = await seedChat(jobId, toolCallId)
    await settleDeepResearchResult(jobId)

    const result = await lcmDescribe.execute('call', { id: chatId })
    const details = result.details as {
      messages: Array<{ role: string; text: string }>
    }

    expect(details.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Research heat pump funding.'],
      [
        'research',
        'Deep research finished: Heat pumps\n\nTenants pay at most 8% of the cost a year.'
      ]
    ])
  })
})
