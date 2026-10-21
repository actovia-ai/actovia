// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShownDefault } from '@/components/settings/shown-default'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function mount(value: number | null, onBlur = vi.fn()) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root!.render(
      createElement(ShownDefault, {
        value,
        fallback: 6,
        onBlur,
        children: (shown) =>
          createElement('input', { type: 'number', readOnly: true, ...shown })
      })
    )
  )
  return host.querySelector('input')!
}

describe('ShownDefault', () => {
  it('shows the default as the value of an unset field', () => {
    expect(mount(null).value).toBe('6')
  })

  it('shows a set value as it is', () => {
    expect(mount(12).value).toBe('12')
  })

  it('leaves an unset field empty while it is being edited, and calls the field’s blur', () => {
    const onBlur = vi.fn()
    const input = mount(null, onBlur)

    act(() => input.dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
    expect(input.value).toBe('')

    act(() =>
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    )
    expect(input.value).toBe('6')
    expect(onBlur).toHaveBeenCalledOnce()
  })
})
