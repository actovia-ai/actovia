import { flattenTestIds } from '@actovia/shared/constants/test-ids'
import { describe, expect, it } from 'vitest'

describe('TEST_IDS', () => {
  it('flattens to accessor → value pairs', () => {
    const flat = flattenTestIds()
    expect(flat).toContainEqual({
      accessor: 'TEST_IDS.lock.pinInput',
      value: 'lock.pin-input'
    })
  })

  it('has unique values', () => {
    const values = flattenTestIds().map((e) => e.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('value matches the camelCase→kebab of its path', () => {
    for (const { accessor, value } of flattenTestIds()) {
      const path = accessor
        .replace(/^TEST_IDS\./, '')
        .split('.')
        .map((seg) => seg.replaceAll(/[A-Z]/g, (m) => `-${m.toLowerCase()}`))
        .join('.')
      expect(value).toBe(path)
    }
  })
})
