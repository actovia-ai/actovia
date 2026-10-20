import type { MemoryChange } from '@actovia/shared/types/memory'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

// Real SQL against a real, in-memory PGlite with the shipped migrations, so
// the before/after snapshots are compared against the rows the app actually
// stores — same pattern as instruction-changes.test.ts.
vi.mock('@main/lib/db/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite')
  const { createMigratedPglite } =
    await import('../../../../helpers/migrated-pglite')
  const pglite = await createMigratedPglite('0008')
  return { pglite, db: drizzle(pglite) }
})

const mockCompleteSimple = vi.fn()
vi.mock('@main/lib/ai/kernel/models', () => ({
  getKernelModels: () => ({
    completeSimple: (...args: unknown[]) => mockCompleteSimple(...args)
  })
}))

const { pglite } = await import('@main/lib/db/db')
const { createMemory, getMemoryById, hardDeleteMemory, updateMemory } =
  await import('@main/lib/db/memory-queries')
const { snapshotOf, LOCAL_USER_ID } =
  await import('@main/lib/ai/memory/manager')
const { undoMemoryChanges } = await import('@main/lib/ai/memory/undo')

/** `updateMemory` returns `MemoryRow | null`; test setup only ever hits rows
 *  it just created, so a `null` here means the setup itself is broken. */
async function mustUpdate(
  id: string,
  data: Parameters<typeof updateMemory>[1]
) {
  const row = await updateMemory(id, data)
  if (!row) throw new Error('test setup: updateMemory returned null')
  return row
}

afterAll(async () => {
  await pglite.close()
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('undoMemoryChanges', () => {
  it('reverses create, update and delete, newest first', async () => {
    const a1 = await createMemory({
      userId: LOCAL_USER_ID,
      section: 'profile',
      key: 'Work setup',
      summary: 'Uses macOS',
      details: ['MacBook'],
      source: 'explicit'
    })
    const a2 = await mustUpdate(a1.id, {
      summary: 'Uses Linux',
      details: ['ThinkPad']
    })
    const updateChange: MemoryChange = {
      op: 'update',
      id: a1.id,
      before: snapshotOf(a1),
      after: snapshotOf(a2)
    }

    const b1 = await createMemory({
      userId: LOCAL_USER_ID,
      section: 'topic',
      key: 'Rust',
      summary: 'Learning Rust',
      details: [],
      source: 'explicit'
    })
    const createChange: MemoryChange = {
      op: 'create',
      id: b1.id,
      before: null,
      after: snapshotOf(b1)
    }

    const c1 = await createMemory({
      userId: LOCAL_USER_ID,
      section: 'person',
      key: 'Old address',
      summary: 'Lived in Lyon',
      details: [],
      source: 'implicit'
    })
    const deleteChange: MemoryChange = {
      op: 'delete',
      id: c1.id,
      before: snapshotOf(c1),
      after: null
    }
    await hardDeleteMemory(c1.id)

    // The order the changes were applied in — undo walks it in reverse.
    const changes = [updateChange, createChange, deleteChange]

    const result = await undoMemoryChanges(changes)

    expect(result).toEqual({
      undone: [c1.id, b1.id, a1.id],
      skipped: []
    })

    const restoredA = await getMemoryById(a1.id)
    expect(restoredA?.summary).toBe('Uses macOS')
    expect(restoredA?.details).toEqual(['MacBook'])

    expect(await getMemoryById(b1.id)).toBeNull()

    const restoredC = await getMemoryById(c1.id)
    expect(restoredC?.id).toBe(c1.id)
    expect(restoredC?.summary).toBe('Lived in Lyon')
  })

  it('skips an entry changed since, and reports it', async () => {
    const row = await createMemory({
      userId: LOCAL_USER_ID,
      section: 'profile',
      key: 'Timezone',
      summary: 'Pacific',
      details: [],
      source: 'explicit'
    })
    // Recorded as if the instruction had changed it from "Eastern" to
    // "Pacific" — but the user then edited it again, elsewhere.
    const change: MemoryChange = {
      op: 'update',
      id: row.id,
      before: {
        section: 'profile',
        key: 'Timezone',
        summary: 'Eastern',
        details: [],
        isActive: true
      },
      after: snapshotOf(row)
    }
    await updateMemory(row.id, { summary: 'Mountain' })

    const result = await undoMemoryChanges([change])

    expect(result).toEqual({ undone: [], skipped: [row.id] })
    const current = await getMemoryById(row.id)
    expect(current?.summary).toBe('Mountain')
  })

  it('is a no-op the second time', async () => {
    const row = await createMemory({
      userId: LOCAL_USER_ID,
      section: 'topic',
      key: 'Coffee',
      summary: 'Likes espresso',
      details: [],
      source: 'explicit'
    })
    const updated = await mustUpdate(row.id, { summary: 'Likes pour-over' })
    const change: MemoryChange = {
      op: 'update',
      id: row.id,
      before: snapshotOf(row),
      after: snapshotOf(updated)
    }

    const first = await undoMemoryChanges([change])
    expect(first).toEqual({ undone: [row.id], skipped: [] })
    const afterFirst = await getMemoryById(row.id)

    const second = await undoMemoryChanges([change])
    expect(second).toEqual({ undone: [], skipped: [row.id] })
    const afterSecond = await getMemoryById(row.id)
    expect(afterSecond).toEqual(afterFirst)
  })

  it('treats a missing row as matching after === null', async () => {
    const id = crypto.randomUUID()
    const change: MemoryChange = {
      op: 'delete',
      id,
      before: {
        section: 'topic',
        key: 'Ghost',
        summary: 'Never existed live',
        details: ['x'],
        isActive: true
      },
      after: null
    }

    const result = await undoMemoryChanges([change])

    expect(result).toEqual({ undone: [id], skipped: [] })
    const restored = await getMemoryById(id)
    expect(restored?.id).toBe(id)
    expect(restored?.key).toBe('Ghost')
  })
})
