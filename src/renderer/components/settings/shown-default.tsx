import { type FocusEvent, type ReactElement, useState } from 'react'

type Shown = {
  value: number | string
  onFocus: (event: FocusEvent<HTMLInputElement>) => void
  onBlur: (event: FocusEvent<HTMLInputElement>) => void
}

/**
 * A number field whose unset (null) value means a default: the default is
 * shown as the field's value, in the same ink as any set value, instead of a
 * grey placeholder that reads as empty. While the field has focus an unset
 * value stays empty, so deleting the digits to type new ones does not snap
 * the default back in under the caret.
 */
export function ShownDefault({
  value,
  fallback,
  onBlur,
  children
}: {
  value: number | null | undefined
  fallback: number
  /** The field's own blur (react-hook-form's `field.onBlur`). */
  onBlur?: () => void
  children: (shown: Shown) => ReactElement
}) {
  const [editing, setEditing] = useState(false)
  return children({
    value: value ?? (editing ? '' : fallback),
    onFocus: () => setEditing(true),
    onBlur: () => {
      setEditing(false)
      onBlur?.()
    }
  })
}
