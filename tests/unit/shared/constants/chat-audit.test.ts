import { readFileSync } from 'fs'
import { join } from 'path'

import { CHAT_AUDIT_PRESETS } from '@actovia/shared/constants/chat-audit-presets'
import {
  CHAT_AUDIT_SCHEMA,
  CHAT_AUDIT_SCHEMA_VERSION,
  schemaFingerprint
} from '@actovia/shared/constants/chat-audit-schema'
import { describe, expect, it } from 'vitest'

import { PRESET_KEYS } from '@/components/settings/settings-form/chat-audit-preset-keys'

const en = JSON.parse(
  readFileSync(
    join(process.cwd(), 'packages/shared/src/i18n/locales/en/settings.json'),
    'utf8'
  )
) as { chatAudit: { presets: Record<string, string> } }

describe('Chat Audit presets', () => {
  // The prompt-cache preset shipped with a blank button: its id had no label.
  it('gives every preset a label in the catalog', () => {
    const labels = en.chatAudit.presets
    for (const { id } of CHAT_AUDIT_PRESETS) {
      const key = (PRESET_KEYS as Record<string, string>)[id]
      expect(key, id).toBe(`chatAudit.presets.${id}`)
      expect(labels[id], id).toBeTruthy()
    }
  })
})

// A snapshot built before a column was added cannot run the presets that read
// it; the page tells the user to rebuild when the fingerprints differ.
describe('CHAT_AUDIT_SCHEMA_VERSION', () => {
  it('is the fingerprint of the current tables', () => {
    expect(CHAT_AUDIT_SCHEMA_VERSION).toBe(schemaFingerprint(CHAT_AUDIT_SCHEMA))
  })

  it('changes when a column is added', () => {
    const grown = {
      ...CHAT_AUDIT_SCHEMA,
      messages: { ...CHAT_AUDIT_SCHEMA.messages, extra: 'VARCHAR' }
    }
    expect(schemaFingerprint(grown)).not.toBe(CHAT_AUDIT_SCHEMA_VERSION)
  })
})
