// src/main/lib/ai/philharmonic/recruit.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@earendil-works/pi-ai', () => ({
  completeSimple: vi.fn(async () => ({
    content: [
      {
        type: 'text',
        text: '{"name":"","description":"Crunches numbers","systemPrompt":"You analyze data."}'
      }
    ]
  }))
}))
vi.mock('@main/lib/db/queries', () => ({
  getSettings: async () => ({ id: 's' })
}))
vi.mock('@main/lib/ai/utils/chat-message-util', () => ({
  getModelFromProvider: () => ({ chatModel: {}, apiKey: 'k' })
}))
const createAgent = vi.fn(async (d) => ({ id: 'a1', ...d }))
const getAllAgents = vi.fn(async () => [{ name: 'Avery' }])
vi.mock('@main/lib/db/philharmonic-queries', () => ({
  createAgent,
  getAllAgents
}))

vi.mock('@main/lib/ai/skills/skills-manager', () => ({
  listInstalledSkills: async () => [{ slug: 'python' }, { slug: 'sql' }]
}))

const { autoCreateEmployee } = await import('@main/lib/ai/philharmonic/recruit')

describe('autoCreateEmployee', () => {
  it('fills a name from the pool when LLM returns none, and sets avatar seed', async () => {
    await autoCreateEmployee({
      role: 'Data analyst',
      skills: ['python']
    })
    expect(createAgent).toHaveBeenCalled()
    const arg = createAgent.mock.calls[0][0]
    expect(arg.name).toBeTruthy()
    expect(arg.name).not.toBe('Avery') // avoided the taken name
    expect(arg.avatarSeed).toMatch(/^[a-z0-9]+$/i)
    expect(arg.avatarStyle).toBeTruthy()
    expect(arg.isActive).toBe(true)
  })

  it('honors an explicit name', async () => {
    await autoCreateEmployee({ role: 'Writer', name: 'Pat' })
    const arg = createAgent.mock.calls.at(-1)![0]
    expect(arg.name).toBe('Pat')
  })

  it('keeps only installed skill slugs, so an invented one does not empty the picks', async () => {
    await autoCreateEmployee({ role: 'Analyst', skills: ['python', 'excel'] })
    expect(createAgent.mock.calls.at(-1)![0].skillSlugs).toEqual(['python'])
    await autoCreateEmployee({ role: 'Analyst', skills: ['excel'] })
    expect(createAgent.mock.calls.at(-1)![0].skillSlugs).toEqual([])
  })
})
