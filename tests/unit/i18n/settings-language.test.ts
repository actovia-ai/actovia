import { LOCALE_IDS } from '@actovia/shared/i18n/locales'
import { SettingsSchema } from '@actovia/shared/schemas/settings-schema'
import { describe, expect, it } from 'vitest'

const base = { id: 'global', createdAt: new Date(), updatedAt: new Date() }

describe('SettingsSchema.language', () => {
  it("accepts 'auto'", () => {
    expect(SettingsSchema.parse({ ...base, language: 'auto' }).language).toBe(
      'auto'
    )
  })
  it.each(LOCALE_IDS)("accepts locale id '%s'", (id) => {
    expect(SettingsSchema.parse({ ...base, language: id }).language).toBe(id)
  })
  it('accepts null/undefined (pre-migration rows)', () => {
    expect(SettingsSchema.parse({ ...base }).language).toBeUndefined()
    expect(
      SettingsSchema.parse({ ...base, language: null }).language
    ).toBeNull()
  })
  it('rejects an unknown value', () => {
    expect(() => SettingsSchema.parse({ ...base, language: 'zh-CN' })).toThrow()
  })
})
