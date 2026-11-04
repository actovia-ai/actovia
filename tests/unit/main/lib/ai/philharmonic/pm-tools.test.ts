import { AiProviders } from '@actovia/shared/types/ai'
// src/main/lib/ai/philharmonic/pm-tools.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@earendil-works/pi-ai', () => ({
  StringEnum: (values: string[], options?: unknown) => ({ values, options }),
  Type: {
    Object: (o: unknown) => o,
    String: (o?: unknown) => o ?? {},
    Number: (o?: unknown) => o ?? {},
    Array: (t: unknown, o?: unknown) => o ?? {}
  }
}))

const {
  createDelegateTaskTool,
  createRecruitEmployeeTool,
  createWaitForQuotaTool,
  quotaWaitRunAt
} = await import('@main/lib/ai/philharmonic/pm-tools')

describe('pm-tools', () => {
  it('delegate tool lists the roster and calls the callback', async () => {
    const onDelegate = vi.fn(async () => 'employee result')
    const tool = createDelegateTaskTool(
      [{ id: 'a1', name: 'Avery', description: 'Analyst' }],
      onDelegate
    )
    expect(tool.description).toContain('Avery')
    const res = await tool.execute('id', {
      employeeId: 'a1',
      instructions: 'go'
    })
    expect(onDelegate).toHaveBeenCalledWith({
      employeeId: 'a1',
      instructions: 'go',
      mode: 'await',
      stepId: undefined
    })
    expect(JSON.stringify(res)).toContain('employee result')
  })

  it('delegate tool refuses an id outside its roster, and accepts one recruited later', async () => {
    const onDelegate = vi.fn(async () => 'employee result')
    const roster = [{ id: 'a1', name: 'Avery', description: 'Analyst' }]
    const tool = createDelegateTaskTool(roster, onDelegate)
    const res = await tool.execute('id', {
      employeeId: 'evil',
      instructions: 'rm -rf'
    })
    expect(onDelegate).not.toHaveBeenCalled()
    expect(JSON.stringify(res)).toContain(
      'Unknown employee id evil — choose one from the list'
    )
    roster.push({ id: 'a2', name: 'Quinn', description: 'Writer' })
    await tool.execute('id', { employeeId: 'a2', instructions: 'go' })
    expect(onDelegate).toHaveBeenCalledWith({
      employeeId: 'a2',
      instructions: 'go',
      mode: 'await',
      stepId: undefined
    })
  })

  it('recruit tool assigns the selected configured model', async () => {
    const onRecruit = vi.fn(async () => ({
      id: 'a2',
      name: 'Quinn',
      provider: 'openai',
      model: 'gpt-test'
    }))
    const options = [
      {
        value: `${AiProviders.OpenAiGpt}::gpt-test`,
        provider: AiProviders.OpenAiGpt,
        model: 'gpt-test',
        displayName: 'GPT Test',
        snapshot: {
          contextWindow: 128_000,
          maxOutputTokens: 16_000,
          reasoningLevels: ['high'],
          adaptiveThinking: null,
          budgetThinking: null
        },
        isDefault: false
      }
    ]
    const tool = createRecruitEmployeeTool(options, onRecruit)
    const res = await tool.execute('id', {
      role: 'Writer',
      skills: [],
      model: `${AiProviders.OpenAiGpt}::gpt-test`
    })
    expect(onRecruit).toHaveBeenCalledWith({
      role: 'Writer',
      skills: [],
      name: undefined,
      provider: AiProviders.OpenAiGpt,
      model: 'gpt-test'
    })
    expect(JSON.stringify(res)).toContain('a2')
  })

  it('rejects a model outside the configured recruitment options', async () => {
    const onRecruit = vi.fn()
    const tool = createRecruitEmployeeTool(
      [
        {
          value: `${AiProviders.OpenAiGpt}::gpt-test`,
          provider: AiProviders.OpenAiGpt,
          model: 'gpt-test',
          displayName: 'GPT Test',
          snapshot: {
            contextWindow: 128_000,
            maxOutputTokens: 16_000,
            reasoningLevels: [],
            adaptiveThinking: null,
            budgetThinking: null
          },
          isDefault: false
        }
      ],
      onRecruit
    )
    await expect(
      tool.execute('id', {
        role: 'Writer',
        skills: [],
        model: 'unconfigured::model'
      })
    ).rejects.toThrow('Choose an employee model from the configured list.')
    expect(onRecruit).not.toHaveBeenCalled()
  })

  it('wait tool passes step, employee and reason through', async () => {
    const onWait = vi.fn(async () => 'waiting until Tue 07:02')
    const tool = createWaitForQuotaTool(onWait)
    expect(tool.name).toBe('waitForQuota')
    const res = await tool.execute('id', {
      stepId: 's1',
      employeeId: 'a1',
      reason: 'needs opus'
    })
    expect(onWait).toHaveBeenCalledWith({
      stepId: 's1',
      employeeId: 'a1',
      reason: 'needs opus'
    })
    expect(JSON.stringify(res)).toContain('waiting until')
  })

  it('a wait wakes two minutes after the reset; an unknown reset is checked in an hour', () => {
    expect(quotaWaitRunAt(1000, 0)).toEqual(new Date(121_000))
    expect(quotaWaitRunAt(null, 0)).toEqual(new Date(3_600_000))
    // a reset already past
    expect(quotaWaitRunAt(0, 5000)).toEqual(new Date(125_000))
  })
})
