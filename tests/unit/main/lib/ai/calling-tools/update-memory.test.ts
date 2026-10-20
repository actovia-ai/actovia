import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { MemoryChange } from '@actovia/shared/types/memory'
import type { Model } from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'

const runMemoryInstruction = vi.fn()
vi.mock('@main/lib/ai/memory/manager', () => ({ runMemoryInstruction }))

const enSettings = JSON.parse(
  readFileSync(
    join(process.cwd(), 'packages/shared/src/i18n/locales/en/settings.json'),
    'utf8'
  )
)

const { updateMemory } =
  await import('@main/lib/ai/calling-tools/update-memory')

const model = { id: 'gpt-5' } as unknown as Model<string>

const snapshot = (key: string) => ({
  section: 'topic' as const,
  key,
  summary: 'a summary',
  details: [],
  isActive: true
})

const update = (key: string): MemoryChange => ({
  op: 'update',
  id: 'mem-1',
  before: snapshot(key),
  after: snapshot(key)
})

const del = (key: string): MemoryChange => ({
  op: 'delete',
  id: 'mem-2',
  before: snapshot(key),
  after: null
})

const create = (key: string): MemoryChange => ({
  op: 'create',
  id: 'mem-3',
  before: null,
  after: snapshot(key)
})

describe('updateMemory tool', () => {
  it('passes the instruction and returns a summary + changes', async () => {
    runMemoryInstruction.mockResolvedValue({
      applied: 2,
      changes: [update('Work setup'), del('Old address')]
    })
    const tool = updateMemory(model, 'k')
    const result = await tool.execute('call-1', {
      instruction: 'I use Linux now'
    })

    expect(runMemoryInstruction).toHaveBeenCalledWith(
      'I use Linux now',
      null,
      model,
      'k'
    )
    expect(result.content[0]).toEqual({
      type: 'text',
      text: "Updated 'Work setup'; deleted 'Old address'."
    })
    expect(result.details.changes).toHaveLength(2)
  })

  it('capitalises the summary when the first change is a delete', async () => {
    runMemoryInstruction.mockResolvedValue({
      applied: 1,
      changes: [del('Old address')]
    })
    const tool = updateMemory(model, 'k')
    const result = await tool.execute('call-2', { instruction: 'forget it' })
    expect(result.content[0]).toEqual({
      type: 'text',
      text: "Deleted 'Old address'."
    })
  })

  it('lowercases every later op label, capitalising only the first', async () => {
    runMemoryInstruction.mockResolvedValue({
      applied: 3,
      changes: [del('Old address'), update('Work setup'), create('New hobby')]
    })
    const tool = updateMemory(model, 'k')
    const result = await tool.execute('call-2b', { instruction: 'tidy up' })
    expect(result.content[0]).toEqual({
      type: 'text',
      text: "Deleted 'Old address'; updated 'Work setup'; added 'New hobby'."
    })
  })

  it('has the Title Case label every other built-in has', () => {
    expect(updateMemory(model, 'k').label).toBe('Update Memory')
    // …and so does its row in Settings → Built-in Tools (English catalog).
    expect(enSettings.tools.registry.updateMemory.label).toBe('Update Memory')
  })

  it('reports a create with "Added"', async () => {
    runMemoryInstruction.mockResolvedValue({
      applied: 1,
      changes: [create('New hobby')]
    })
    const tool = updateMemory(model, 'k')
    const result = await tool.execute('call-3', {
      instruction: 'remember this'
    })
    expect(result.content[0]).toEqual({
      type: 'text',
      text: "Added 'New hobby'."
    })
  })

  it('no change is a normal result', async () => {
    runMemoryInstruction.mockResolvedValue({ applied: 0, changes: [] })
    const tool = updateMemory(model, 'k')
    const result = await tool.execute('call-4', {
      instruction: 'nothing to change'
    })
    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'No memory change was needed.'
    })
    expect(result.details.changes).toEqual([])
  })

  it('an engine failure throws (the kernel turns it into a tool error)', async () => {
    runMemoryInstruction.mockRejectedValue(
      new Error("Couldn't interpret that instruction — try rephrasing.")
    )
    const tool = updateMemory(model, 'k')
    await expect(
      tool.execute('call-5', { instruction: 'garble' })
    ).rejects.toThrow("Couldn't interpret that instruction")
  })

  it('throws when the call was already aborted', async () => {
    const tool = updateMemory(model, 'k')
    const controller = new AbortController()
    controller.abort()
    await expect(
      tool.execute('call-6', { instruction: 'x' }, controller.signal)
    ).rejects.toThrow('Aborted')
    expect(runMemoryInstruction).not.toHaveBeenCalledWith('x', null, model, 'k')
  })
})
