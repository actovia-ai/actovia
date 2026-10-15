import { readFileSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, it } from 'vitest'

const UI = resolve(
  import.meta.dirname,
  '../../../../../src/renderer/components/ui'
)

// The main window is transparent over macOS vibrancy (window.ts): where the
// page draws nothing — the whole sidebar — a backdrop-filter blur leaves the
// text sharp with a glow round it and the material undimmed, while the pane
// beside it blurs (owner's screenshot, 2026-10-15). A scrim only dims. The
// shadcn generator would put the blur back.
describe('overlay scrims', () => {
  it.each(['dialog', 'alert-dialog', 'sheet', 'drawer'])(
    '%s dims without a backdrop blur',
    (name) => {
      const source = readFileSync(resolve(UI, `${name}.tsx`), 'utf8')
      expect(source).toContain('bg-black/30')
      expect(source).not.toMatch(/backdrop-blur|backdrop-filter/u)
    }
  )
})
