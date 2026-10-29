import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import { describe, expect, it } from 'vitest'

import { ALLOWLIST } from './allowlist'

// @babel/traverse ships as CJS; under ESM interop the real function can land
// on `.default` or be the module namespace itself depending on the bundler.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const traverse: any = (_traverse as any).default ?? _traverse

const ROOT = join(__dirname, '..', '..', '..')
const RENDERER_ROOT = join(ROOT, 'src', 'renderer')
const EXCLUDED_DIRS = [join(RENDERER_ROOT, 'components', 'ui')]
const EXCLUDED_FILES = new Set([
  join(RENDERER_ROOT, 'sub-apps', 'artifacts', 'sandbox.tsx')
])

// A JSX text node or toast string must contain a run of 3+ ASCII letters to
// count as "prose" — this excludes pure punctuation/emoji/CJK-only content
// and short symbol fragments.
const PROSE_RE = /[A-Za-z]{3,}/

// Attributes a person reads or hears: the field's hint, a screen reader's
// name, a tooltip, an image's description.
const PROSE_ATTRIBUTES = new Set(['placeholder', 'aria-label', 'title', 'alt'])

interface Violation {
  file: string
  line: number
  text: string
  kind: string
}

// Renderer source files worth scanning: `.tsx` for both the JSX-text check
// and the `toast.add` check, plus plain `.ts` for the `toast.add` check only — a
// hook/service file has no JSX but can still fire a hardcoded toast (e.g.
// `lib/stream-manager.ts` — the React Query migration moved the toasting
// out of the services and into the hooks that own the mutations). `.d.ts` files declare types, never runtime
// strings.
function collectRendererSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (EXCLUDED_DIRS.some((d) => full === d || full.startsWith(d + '/')))
      continue
    if (entry.isDirectory()) {
      out.push(...collectRendererSourceFiles(full))
    } else if (
      (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) &&
      !entry.name.endsWith('.d.ts') &&
      !EXCLUDED_FILES.has(full)
    ) {
      out.push(full)
    }
  }
  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isInsideTransOrT(path: any): boolean {
  let p = path.parentPath
  while (p) {
    if (
      p.isJSXElement() &&
      p.node.openingElement.name.type === 'JSXIdentifier' &&
      p.node.openingElement.name.name === 'Trans'
    ) {
      return true
    }
    if (
      p.isCallExpression() &&
      p.node.callee.type === 'Identifier' &&
      p.node.callee.name === 't'
    ) {
      return true
    }
    p = p.parentPath
  }
  return false
}

// A `toast.add` `title`/`description` value can be a plain string, a template
// literal (check its static quasis), or a ternary picking between two such
// values (check both branches) — all three are just different syntaxes for
// "a hardcoded string ends up in this field", so all three are in scope.
function collectProseFromExpr(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  out: { line: number; text: string }[]
): void {
  if (!node) return
  if (node.type === 'StringLiteral') {
    if (PROSE_RE.test(node.value)) {
      out.push({ line: node.loc?.start.line ?? 0, text: node.value })
    }
  } else if (node.type === 'TemplateLiteral') {
    for (const q of node.quasis) {
      const raw = q.value.cooked ?? q.value.raw
      if (raw && PROSE_RE.test(raw)) {
        out.push({ line: node.loc?.start.line ?? 0, text: raw })
      }
    }
  } else if (node.type === 'ConditionalExpression') {
    collectProseFromExpr(node.consequent, out)
    collectProseFromExpr(node.alternate, out)
  }
}

function scanRendererFile(filePath: string): Violation[] {
  const source = readFileSync(filePath, 'utf8')
  const relPath = relative(ROOT, filePath)
  const violations: Violation[] = []

  // A plain `.ts` file can legally use the old angle-bracket type-assertion
  // syntax (`<T>expr`), which the `jsx` plugin would misparse as a JSX tag —
  // only enable `jsx` for `.tsx`, where that syntax is already illegal.
  const ast = parse(source, {
    sourceType: 'module',
    plugins: filePath.endsWith('.tsx') ? ['jsx', 'typescript'] : ['typescript']
  })

  traverse(ast, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    JSXText(path: any) {
      const text = path.node.value.trim().replace(/\s+/g, ' ')
      if (text && PROSE_RE.test(text) && !isInsideTransOrT(path)) {
        violations.push({
          file: relPath,
          line: path.node.loc?.start.line ?? 0,
          text,
          kind: 'jsx-text'
        })
      }
    },
    // A literal `placeholder="What should the team do?"` is as visible as a
    // text node (two shipped in the schedule form). Words with a space only:
    // a lone token (`placeholder="sk-…"`, `alt="logo"`) is an identifier.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    JSXAttribute(path: any) {
      const { name, value } = path.node
      if (
        name.type === 'JSXIdentifier' &&
        PROSE_ATTRIBUTES.has(name.name) &&
        value?.type === 'StringLiteral' &&
        PROSE_RE.test(value.value) &&
        /\s/.test(value.value.trim())
      ) {
        violations.push({
          file: relPath,
          line: path.node.loc?.start.line ?? 0,
          text: value.value,
          kind: 'jsx-attribute'
        })
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    CallExpression(path: any) {
      const callee = path.node.callee
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'toast' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'add'
      ) {
        const arg = path.node.arguments[0]
        if (arg && arg.type === 'ObjectExpression') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const prop of arg.properties as any[]) {
            if (
              prop.type === 'ObjectProperty' &&
              prop.key.type === 'Identifier' &&
              (prop.key.name === 'title' || prop.key.name === 'description')
            ) {
              const found: { line: number; text: string }[] = []
              collectProseFromExpr(prop.value, found)
              for (const f of found) {
                violations.push({
                  file: relPath,
                  line: f.line,
                  text: f.text,
                  kind: 'toast'
                })
              }
            }
          }
        }
      }
    }
  })

  return violations
}

// Main-process menu/tray labels: `label: '…'` string literals that don't
// route through `mainT(...)`.
function scanMainLabelFile(filePath: string): Violation[] {
  const source = readFileSync(filePath, 'utf8')
  const relPath = relative(ROOT, filePath)
  const violations: Violation[] = []

  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] })

  traverse(ast, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ObjectProperty(path: any) {
      const key = path.node.key
      if (key.type !== 'Identifier' || key.name !== 'label') return
      const found: { line: number; text: string }[] = []
      collectProseFromExpr(path.node.value, found)
      for (const f of found) {
        violations.push({
          file: relPath,
          line: f.line,
          text: f.text,
          kind: 'menu-label'
        })
      }
    }
  })

  return violations
}

function isAllowlisted(v: Violation): boolean {
  return ALLOWLIST.some(
    (e) => e.file === v.file && e.text === v.text && e.line === v.line
  )
}

describe('no-hardcoded-strings guard', () => {
  const rendererFiles = collectRendererSourceFiles(RENDERER_ROOT)
  const mainLabelFiles = [
    join(ROOT, 'src', 'main', 'lib', 'menu.ts'),
    join(ROOT, 'src', 'main', 'lib', 'tray.ts')
  ]

  const violations = [
    ...rendererFiles.flatMap(scanRendererFile),
    ...mainLabelFiles.flatMap(scanMainLabelFile)
  ].filter((v) => !isAllowlisted(v))

  it("has no un-i18n'd JSX text, toast.add title/description, or menu/tray label", () => {
    const report = violations
      .map((v) => `${v.file}:${v.line} [${v.kind}] ${JSON.stringify(v.text)}`)
      .join('\n')
    expect(violations, `hardcoded strings found:\n${report}`).toEqual([])
  })

  it('every allowlist entry still matches a real violation at its pinned file/line/text (no stale or over-broad entries)', () => {
    // Re-scan (not a raw string.includes() check) so a stale entry — the
    // line moved, the text changed, or the whole violation disappeared —
    // fails loudly instead of silently continuing to exempt something
    // unrelated. Using the guard's own scanner also means this test can't
    // drift from what the guard itself actually flags.
    const isMainLabelFile = (p: string) =>
      p === join(ROOT, 'src', 'main', 'lib', 'menu.ts') ||
      p === join(ROOT, 'src', 'main', 'lib', 'tray.ts')

    for (const entry of ALLOWLIST) {
      const full = join(ROOT, entry.file)
      const found = (
        isMainLabelFile(full) ? scanMainLabelFile(full) : scanRendererFile(full)
      ).some((v) => v.text === entry.text && v.line === entry.line)
      expect(
        found,
        `allowlist entry no longer matches a real violation in ${entry.file}:${entry.line}: ${JSON.stringify(entry.text)}`
      ).toBe(true)
    }
  })
})
