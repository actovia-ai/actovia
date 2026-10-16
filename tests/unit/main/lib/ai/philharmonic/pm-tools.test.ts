// src/main/lib/ai/philharmonic/pm-tools.test.ts
import { describe, expect, it, vi } from 'vitest'
vi.mock('@earendil-works/pi-ai', () => ({
  Type: {
    Object: (o: unknown) => o,
    String: (o?: unknown) => o ?? {},
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
      instructions: 'go'
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
      instructions: 'go'
    })
  })

  it('recruit tool calls the callback and returns the new employee id', async () => {
    const onRecruit = vi.fn(async () => ({ id: 'a2', name: 'Quinn' }))
    const tool = createRecruitEmployeeTool(onRecruit)
    const res = await tool.execute('id', { role: 'Writer', skills: [] })
    expect(onRecruit).toHaveBeenCalled()
    expect(JSON.stringify(res)).toContain('a2')
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
