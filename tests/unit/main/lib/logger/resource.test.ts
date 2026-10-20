import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '9.9.9' } }))

const { getResource } = await import('@main/lib/logger/resource')

describe('getResource', () => {
  it('returns the OTel resource fields', () => {
    const r = getResource()
    expect(r['service.name']).toBe('actovia')
    expect(r['service.version']).toBe('9.9.9')
    expect(r['process.runtime.name']).toBe('electron')
    expect(typeof r['process.pid']).toBe('number')
    expect(typeof r['os.type']).toBe('string')
    expect(typeof r['os.version']).toBe('string')
    expect(r['session.id']).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is a stable frozen singleton', () => {
    const a = getResource()
    const b = getResource()
    expect(a).toBe(b)
    expect(Object.isFrozen(a)).toBe(true)
    expect(a['session.id']).toBe(b['session.id'])
  })
})
