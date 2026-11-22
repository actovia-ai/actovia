import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k })
}))

import { Markdown } from '@/components/markdown/markdown'

const html = (src: string) =>
  renderToStaticMarkup(createElement(Markdown, { src }))

describe('a fenced code block', () => {
  it('with no language is a code block labelled Text, as one with a language is', () => {
    const plain = html('```\n[A] ──▶ [B]\n```')
    const typed = html('```ts\nconst a = 1\n```')
    expect(plain).toContain('Text')
    expect(plain).toContain('action.copy')
    expect(plain).toContain('[A] ──▶ [B]')
    // The same structure: the strip, then the highlighter's div in the mono face.
    const shape = (s: string) =>
      (s.match(/<(section|div|pre)\b/gu) ?? []).join()
    expect(shape(plain)).toBe(shape(typed))
  })

  it('leaves inline code inline', () => {
    const out = html('Run `ls` now')
    expect(out).toContain('<code>ls</code>')
    expect(out).not.toContain('Text')
  })

  it('renders patch fences as file diffs without nesting a figure in a pre', () => {
    const out = html(
      '```diff\n--- a/app.ts\n+++ b/app.ts\n@@ -3 +3 @@\n-before\n+after\n```'
    )
    expect(out).toContain('data-slot="code-diff"')
    expect(out).toContain('app.ts')
    expect(out).toContain('data-diff-line="added"')
    expect(out).toContain('data-diff-line="removed"')
    expect(out.indexOf('<figure')).toBeLessThan(out.indexOf('<pre'))
    // Group chat disables interactive fences; it still renders file diffs.
    const group = renderToStaticMarkup(
      createElement(Markdown, {
        src: '```patch\n-old\n+new\n```',
        interactive: false
      })
    )
    expect(group).toContain('data-slot="code-diff"')
  })

  it.each(['diff', 'patch', '', 'text'])(
    'renders the screenshot’s addition-only fragment in a %s fence',
    (language) => {
      const out = renderToStaticMarkup(
        createElement(Markdown, {
          src: `\`\`\`${language}\n+ <key>com.apple.security.application-groups</key>\n+ <array>\n+   <string>group.example</string>\n+ </array>\n\`\`\``,
          interactive: false
        })
      )
      expect(out).toContain('data-slot="code-diff"')
      expect(out.match(/data-diff-line="added"/gu)).toHaveLength(4)
      expect(out).toContain('+4')
      expect(out.indexOf('<figure')).toBeLessThan(out.indexOf('<pre'))
    }
  )

  it('does not infer a diff from inline code or a named programming language', () => {
    expect(html('Use `+ option` here')).not.toContain('data-slot="code-diff"')
    expect(html('```js\n+ value\n+ other\n```')).not.toContain(
      'data-slot="code-diff"'
    )
  })
})
