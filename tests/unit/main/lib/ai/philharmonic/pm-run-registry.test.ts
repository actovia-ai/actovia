import { pmRunRegistry } from '@main/lib/ai/philharmonic/pm-run-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  // Make tests independent — nothing leaks between cases.
  pmRunRegistry.clear('c1')
  pmRunRegistry.clear('c2')
})

describe('pmRunRegistry', () => {
  it('reports has=false and abort=false when nothing is registered', () => {
    expect(pmRunRegistry.has('c1')).toBe(false)
    expect(pmRunRegistry.abort('c1')).toBe(false)
  })

  it('aborts the registered controller and clears the slot', () => {
    const c = new AbortController()
    pmRunRegistry.set('c1', c)
    expect(pmRunRegistry.has('c1')).toBe(true)
    expect(pmRunRegistry.abort('c1')).toBe(true)
    expect(c.signal.aborted).toBe(true)
    // After abort the slot can still hold the signaled controller until the
    // route clears it; downstream code uses signal.aborted not has().
    pmRunRegistry.clear('c1')
    expect(pmRunRegistry.has('c1')).toBe(false)
  })

  it('replaces an older controller when a newer one is registered', () => {
    const a = new AbortController()
    const b = new AbortController()
    pmRunRegistry.set('c1', a)
    pmRunRegistry.set('c1', b)
    pmRunRegistry.abort('c1')
    expect(a.signal.aborted).toBe(false)
    expect(b.signal.aborted).toBe(true)
  })

  it('isolates conversations', () => {
    const a = new AbortController()
    const b = new AbortController()
    pmRunRegistry.set('c1', a)
    pmRunRegistry.set('c2', b)
    pmRunRegistry.abort('c1')
    expect(a.signal.aborted).toBe(true)
    expect(b.signal.aborted).toBe(false)
  })

  it('serializes rounds for one conversation in FIFO order', async () => {
    const order: string[] = []
    let releaseFirst!: () => void
    const first = pmRunRegistry.run('c1', async () => {
      order.push('first:start')
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      order.push('first:end')
    })
    const second = pmRunRegistry.run('c1', async () => {
      order.push('second')
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second'])
  })

  it('lets a later round run after an earlier one fails', async () => {
    const later = vi.fn(async () => {})
    await expect(
      pmRunRegistry.run('c1', async () => {
        throw new Error('failed')
      })
    ).rejects.toThrow('failed')
    await pmRunRegistry.run('c1', later)
    expect(later).toHaveBeenCalledTimes(1)
  })
})
