import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { archivePath, downloadArchive } from '@main/lib/ai/philharmonic/archive'
import { loopBudget } from '@main/lib/ai/philharmonic/loop-budget'
import { pmRunRegistry } from '@main/lib/ai/philharmonic/pm-run-registry'
import { acquireStaffSlot } from '@main/lib/ai/philharmonic/staff-slots'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('Group runtime controls', () => {
  it('prioritizes owner messages over queued employee reports', async () => {
    const order: string[] = []
    let release!: () => void
    const first = pmRunRegistry.run('priority', async () => {
      order.push('first')
      await new Promise<void>((r) => {
        release = r
      })
    })
    await tick()
    const report = pmRunRegistry.run('priority', async () => {
      order.push('report')
    })
    const owner = pmRunRegistry.run(
      'priority',
      async () => {
        order.push('owner')
      },
      true
    )
    release()
    await Promise.all([first, report, owner])
    expect(order).toEqual(['first', 'owner', 'report'])
  })
  it('drains steering once and refuses it after the final request boundary', async () => {
    pmRunRegistry.set('steering', new AbortController())
    pmRunRegistry.openSteering('steering')
    expect(
      pmRunRegistry.steer('steering', {
        text: 'Use a PDF instead',
        messageId: 'm2'
      })
    ).toBe(true)
    expect(pmRunRegistry.takeSteering('steering')).toEqual([
      { text: 'Use a PDF instead', messageId: 'm2' }
    ])
    expect(pmRunRegistry.takeSteering('steering')).toEqual([])
    pmRunRegistry.closeSteering('steering')
    expect(pmRunRegistry.steer('steering', { text: 'new request' })).toBe(false)
    pmRunRegistry.clear('steering')
  })
  it('Stop clears queued rounds instead of starting them after the abort', async () => {
    let release!: () => void
    let ran = false
    const first = pmRunRegistry.run('stop', async () => {
      await new Promise<void>((r) => {
        release = r
      })
    })
    await tick()
    const next = pmRunRegistry.run('stop', async () => {
      ran = true
    })
    pmRunRegistry.abort('stop')
    release()
    await Promise.all([first, next])
    expect(ran).toBe(false)
  })
  it('shares concurrency across agents and removes an aborted waiter', async () => {
    const release = await acquireStaffSlot(1)
    const abort = new AbortController()
    const waiting = acquireStaffSlot(1, abort.signal)
    abort.abort()
    await expect(waiting).rejects.toThrow()
    release()
    release()
    const secondRelease = await acquireStaffSlot(1)
    secondRelease()
  })
  it('honors a configured repeated-failure limit', () => {
    const budget = loopBudget(10, 1)
    const context = {
      toolCall: { name: 'terminal' },
      args: { command: 'fail' }
    }
    expect(budget.before(context as never)).toBeUndefined()
    budget.after({
      ...context,
      isError: true,
      result: { details: {} }
    } as never)
    expect(budget.before(context as never)).toMatchObject({ terminate: true })
  })
  it('bounds runs and trips on three identical failures', () => {
    const budget = loopBudget(10)
    const context = {
      toolCall: { name: 'terminal' },
      args: { command: 'same failure' }
    } as never
    for (let i = 0; i < 3; i++) {
      expect(budget.before(context)).toBeUndefined()
      budget.after({
        ...(context as object),
        isError: true,
        result: { content: [], details: {} }
      } as never)
    }
    expect(budget.before(context)).toMatchObject({
      block: true,
      terminate: true
    })
    const bounded = loopBudget(1)
    expect(bounded.before(context)).toBeUndefined()
    expect(bounded.before(context)?.reason).toContain('1 tool calls')
  })
  it('registers only workspace deliverables and downloads a folder as a zip', async () => {
    const root = await mkdtemp(join(tmpdir(), 'actovia-archive-'))
    try {
      const work = join(root, 'work')
      await mkdir(work)
      await writeFile(join(work, 'report.md'), '# Verified result')
      await writeFile(join(root, 'outside.md'), 'outside')
      await symlink(join(root, 'outside.md'), join(work, 'escape.md'))
      await mkdir(join(work, '.actovia'))
      await writeFile(join(work, '.actovia', 'secret'), 'metadata')
      await expect(archivePath(work, 'escape.md')).rejects.toThrow('inside')
      await expect(archivePath(work, '.actovia/secret')).rejects.toThrow(
        'metadata'
      )
      const item = await archivePath(work, '.')
      const file = await downloadArchive(item)
      const zip = await JSZip.loadAsync(file.data)
      expect(Object.keys(zip.files)).toEqual(['report.md'])
      expect(await zip.file('report.md')!.async('string')).toBe(
        '# Verified result'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
