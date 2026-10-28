// @vitest-environment happy-dom
import { createBlockSplitter } from '@actovia-ai/streaming-markdown'
import { useMarkdownBlocks } from '@actovia-ai/streaming-markdown/react'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const split = createBlockSplitter()

function mount(initial: string, heal?: (b: string) => string) {
  let seen: string[] = []
  const spy = vi.fn(split)
  function Probe({ src }: { src: string }) {
    seen = useMarkdownBlocks(src, spy, heal)
    return null
  }
  const root = createRoot(document.createElement('div'))
  const render = (src: string) =>
    act(() => root.render(createElement(Probe, { src })))
  render(initial)
  return { blocks: () => seen, render, spy }
}

describe('useMarkdownBlocks', () => {
  it('renders text that never changes whole, without parsing it', () => {
    const { blocks, spy } = mount('A.\n\nB.')

    expect(blocks()).toEqual(['A.\n\nB.'])
    expect(spy).not.toHaveBeenCalled()
  })

  it('splits once the text streams, and heals only the last block', () => {
    const heal = (b: string) => `${b}|healed`
    const { blocks, render } = mount('A.', heal)

    render('A.\n\nB **x')

    expect(blocks()).toEqual(['A.\n\n', 'B **x|healed'])
  })
})
