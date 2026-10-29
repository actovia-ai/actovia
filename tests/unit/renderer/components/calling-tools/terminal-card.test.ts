// @vitest-environment happy-dom
// src/renderer/components/calling-tools/terminal/terminal-card.tsx and
// generic-tool-card.tsx — AI Elements' Tool / Terminal line (ISSUE-293): a
// success is one line that opens on its output, a failure says so in the
// destructive colour and opens by itself.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const t = (key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}(${Object.values(opts).join(',')})` : key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))

const { TerminalCard } =
  await import('@/components/calling-tools/terminal/terminal-card')
const { GenericToolCard } =
  await import('@/components/calling-tools/generic-tool-card')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
})

function render(element: ReturnType<typeof createElement>) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(element))
  return host
}

const trigger = (el: HTMLElement) =>
  el.querySelector<HTMLElement>('[data-slot="trace-collapsible-trigger"]')!

describe('TerminalCard', () => {
  const ran = {
    command: 'git status --short',
    cwd: '/tmp/work',
    exitCode: 0,
    stdout: ' M app.ts',
    stderr: ''
  }

  it('a success is one closed line, "Ran …", that opens on the output', () => {
    const el = render(createElement(TerminalCard, { toolResult: ran }))
    expect(el.textContent).toContain('terminalCard.ran(git status --short)')
    expect(trigger(el).getAttribute('aria-expanded')).toBe('false')
    expect(el.querySelector('[data-status="error"]')).toBeNull()

    act(() => trigger(el).click())
    expect(trigger(el).getAttribute('aria-expanded')).toBe('true')
    expect(el.textContent).toContain(' M app.ts')
    expect(el.textContent).toContain('/tmp/work')
  })

  it('a failure reads as an error, opens by itself and shows stderr as destructive', () => {
    const el = render(
      createElement(TerminalCard, {
        toolResult: {
          ...ran,
          command: 'pnpm lint',
          exitCode: 1,
          stdout: '',
          stderr: 'lint failed'
        }
      })
    )
    expect(el.textContent).toContain('terminalCard.exited(pnpm lint,1)')
    expect(el.querySelector('[data-status="error"]')).not.toBeNull()
    expect(trigger(el).getAttribute('aria-expanded')).toBe('true')
    const block = el.querySelector('[data-slot="code-block"]')
    expect(block?.getAttribute('data-variant')).toBe('destructive')
    expect(block?.textContent).toContain('lint failed')
  })

  it('a command with no output says so', () => {
    const el = render(
      createElement(TerminalCard, { toolResult: { ...ran, stdout: '' } })
    )
    act(() => trigger(el).click())
    expect(el.textContent).toContain('terminalCard.noOutput')
  })
})

describe('GenericToolCard', () => {
  it('is "Called <tool>", opening on the payload as JSON', () => {
    const el = render(
      createElement(GenericToolCard, {
        toolName: 'list_issues',
        output: { count: 2 }
      })
    )
    expect(el.textContent).toContain('genericToolCard.called(List Issues)')
    act(() => trigger(el).click())
    expect(el.querySelector('pre')?.textContent).toContain('"count": 2')
  })

  it('without a payload it is a line that does not open', () => {
    const el = render(
      createElement(GenericToolCard, { toolName: 'ping', output: null })
    )
    expect(el.textContent).toContain('genericToolCard.called(Ping)')
    expect(
      el.querySelector('[data-slot="trace-collapsible-trigger"]')
    ).toBeNull()
  })
})
