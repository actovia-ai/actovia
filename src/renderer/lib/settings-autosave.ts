import {
  SettingsSchema,
  type Settings
} from '@actovia/shared/schemas/settings-schema'
import { cloneDeep, get, isEqual, set } from 'lodash-es'

import { clearMovedSecrets } from '@/lib/secrets'

export type SettingsSaveResult =
  | {
      status: 'save'
      payload: Settings
      /** Masked keys this save clears because their address moved. */
      clearedSecrets: string[]
    }
  | { status: 'noop' }
  | { status: 'invalid'; errors: string[] }

/**
 * Build the payload for a settings autosave from the last **persisted** settings
 * plus a batch of pending field changes (dotted path → latest raw value).
 *
 * The key move is merging the changes onto `persisted` — never onto the live
 * form object. `persisted` is known-good (it round-tripped through the server),
 * so an unrelated half-typed field elsewhere in the form can neither block this
 * write nor ride along into it. Whatever fails validation here is, by
 * construction, one of the fields the user just touched.
 *
 * Numeric fields (`<input type="number">` stores a string) are coerced by the
 * schema's `formNumber` preprocess, so the returned `payload` carries real
 * numbers, matching what the old `form.handleSubmit(persist)` produced.
 */
export function buildSettingsSave(
  persisted: Settings,
  changes: Map<string, unknown>
): SettingsSaveResult {
  const candidate = cloneDeep(persisted)
  let dirty = false
  for (const [path, value] of changes) {
    if (!isEqual(get(candidate, path), value)) {
      set(candidate, path, value)
      dirty = true
    }
  }
  if (!dirty) return { status: 'noop' }
  // A key shown as its mask cannot follow a new base URL (the server clears
  // it); clearing it here too keeps the cache — and the form — truthful.
  const clearedSecrets = clearMovedSecrets(persisted, candidate)

  const parsed = SettingsSchema.safeParse(candidate)
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => {
      const path = i.path.join('.')
      return path ? `${path}: ${i.message}` : i.message
    })
    return { status: 'invalid', errors }
  }
  return {
    status: 'save',
    payload: { ...parsed.data, id: persisted.id } as Settings,
    clearedSecrets
  }
}
