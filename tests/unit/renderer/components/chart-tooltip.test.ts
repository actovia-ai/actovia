import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart'

function renderTooltip(
  props: Partial<ComponentProps<typeof ChartTooltipContent>> = {}
) {
  return renderToStaticMarkup(
    createElement(ChartContainer, {
      config: { completed: { label: 'Completed' } },
      children: createElement(ChartTooltipContent, {
        active: true,
        label: 0,
        payload: [{ dataKey: 'completed', name: 'completed', value: 2 }],
        ...props
      })
    })
  )
}

describe('chart tooltip labels', () => {
  it('passes numeric axis labels to the formatter, including zero', () => {
    const labelFormatter = vi.fn(String)
    for (const label of [0, new Date('2026-11-05').getTime()]) {
      renderTooltip({ label, labelFormatter })
      expect(labelFormatter).toHaveBeenLastCalledWith(label, expect.any(Array))
    }
    expect(renderTooltip()).toContain('>0</div>')
  })

  it('keeps configured string labels and explicit series label keys', () => {
    const labelFormatter = vi.fn(String)
    renderTooltip({ label: 'completed', labelFormatter })
    expect(labelFormatter).toHaveBeenLastCalledWith(
      'Completed',
      expect.any(Array)
    )
    renderTooltip({ labelKey: 'completed', label: 0, labelFormatter })
    expect(labelFormatter).toHaveBeenLastCalledWith(
      'Completed',
      expect.any(Array)
    )
  })

  it('does not format stale payloads while the tooltip is inactive', () => {
    const labelFormatter = vi.fn(() => {
      throw new RangeError('Invalid time value')
    })
    expect(() =>
      renderTooltip({ active: false, label: undefined, labelFormatter })
    ).not.toThrow()
    expect(labelFormatter).not.toHaveBeenCalled()
  })
})
