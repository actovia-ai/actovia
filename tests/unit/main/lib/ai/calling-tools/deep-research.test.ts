// src/main/lib/ai/calling-tools/deep-research.ts — the tool saves the job and
// runs it in process. It used to POST to our own port without awaiting or
// catching it: when that request failed, the job stayed 'streaming' forever.
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const settings = { id: 'settings-1' }
const saveDeepResearch = vi.fn(async () => {})
vi.mock('@main/lib/db/queries', () => ({
  getSettings: async () => settings,
  saveDeepResearch: (...args: unknown[]) => saveDeepResearch(...(args as []))
}))

const runDeepResearchJob = vi.fn(async () => ({ jobStatus: 'archived' }))
vi.mock('@main/lib/server/routes/deep-research', () => ({
  runDeepResearchJob: (...args: unknown[]) =>
    runDeepResearchJob(...(args as []))
}))

const fetchSpy = vi.spyOn(globalThis, 'fetch')

const { deepResearch } =
  await import('@main/lib/ai/calling-tools/deep-research')

describe('deep_research tool', () => {
  it('saves the job streaming and runs it in process, not over HTTP', async () => {
    const result = await deepResearch.execute('call-1', { subject: 'Heat' })
    const details = result.details as { id: string; toolCallId: string }
    expect(saveDeepResearch).toHaveBeenCalledWith(
      expect.objectContaining({ id: details.id, jobStatus: 'streaming' })
    )
    expect(runDeepResearchJob).toHaveBeenCalledWith(
      details.id,
      'Heat',
      settings
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a job that could not end is logged, never an unhandled rejection', async () => {
    runDeepResearchJob.mockRejectedValueOnce(new Error('db gone'))
    const { logger } = await import('@main/lib/logger')
    await deepResearch.execute('call-2', { subject: 'Heat' })
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled())
  })
})
