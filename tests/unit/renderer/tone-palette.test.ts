// The colour tones (Settings → General → Color tone). The accents are the
// owner's reference — ChatGPT's accent colours, 2026-09-29 — and the same
// ones actovia-ios draws. Fill, readable ink and selection are independent
// of the neutral structural surfaces.
import { readFileSync } from 'fs'
import { join, resolve } from 'path'

import { describe, expect, it } from 'vitest'

import { contrastOf } from '../helpers/color'

const ROOT = resolve(import.meta.dirname, '../../..')
const css = readFileSync(
  join(ROOT, 'src/renderer/assets/stylesheets/globals.css'),
  'utf8'
)

function block(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`)
  if (at === -1) throw new Error(`no block ${selector}`)
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/gu)].map((m) => [m[1], m[2]])
  )
}

const FILLS = {
  emerald: ['#6CB362', '#79BA6F'],
  blue: ['#5480F0', '#5F89F1'],
  violet: ['#8553E7', '#8B60E7'],
  rose: ['#E17EAD', '#E589B4'],
  orange: ['#DE8344', '#E28D55'],
  yellow: ['#EDC859', '#F3D16E']
} as const

const palettes = [
  { name: 'neutral, light', tokens: block(':root') },
  { name: 'neutral, dark', tokens: block('.dark') },
  ...Object.keys(FILLS).flatMap((tone) => [
    {
      name: `${tone}, light`,
      tokens: { ...block(':root'), ...block(`[data-tone='${tone}']`) }
    },
    {
      name: `${tone}, dark`,
      tokens: { ...block('.dark'), ...block(`.dark[data-tone='${tone}']`) }
    }
  ])
]

describe('colour tones', () => {
  it('are the agreed accents, the ones actovia-ios draws', () => {
    for (const [tone, [light, dark]] of Object.entries(FILLS)) {
      // The formatter writes hex in lower case.
      expect(
        block(`[data-tone='${tone}']`)['--primary'].toUpperCase(),
        tone
      ).toBe(light)
      expect(
        block(`.dark[data-tone='${tone}']`)['--primary'].toUpperCase(),
        tone
      ).toBe(dark)
    }
  })

  it('shows each tone in Settings as the fill it is', async () => {
    const { TONE_SWATCHES } =
      await import('@/components/settings/settings-form/generals')
    for (const [tone, [light]] of Object.entries(FILLS)) {
      expect(TONE_SWATCHES[tone as keyof typeof FILLS], tone).toBe(light)
    }
    expect(TONE_SWATCHES.neutral).toBe('var(--tone-neutral)')
    expect(block(':root')['--tone-neutral']).toBe(block(':root')['--primary'])
    expect(block('.dark')['--tone-neutral']).toBe(block('.dark')['--primary'])
  })

  it('neutral is shadcn’s own neutral, unchanged', () => {
    const light = block(':root')
    const dark = block('.dark')
    for (const [name, value] of Object.entries({
      '--background': 'oklch(1 0 0)',
      '--card': 'oklch(1 0 0)',
      '--popover': 'oklch(1 0 0)',
      '--primary': 'oklch(0.205 0 0)',
      '--muted': 'oklch(0.97 0 0)',
      '--accent': 'oklch(0.97 0 0)',
      '--sidebar': 'oklch(0.985 0 0)',
      '--sidebar-accent': 'oklch(0.97 0 0)'
    })) {
      expect(light[name], name).toBe(value)
    }
    for (const [name, value] of Object.entries({
      '--background': 'oklch(0.145 0 0)',
      '--card': 'oklch(0.205 0 0)',
      '--primary': 'oklch(0.922 0 0)',
      '--accent': 'oklch(0.269 0 0)',
      '--sidebar': 'oklch(0.205 0 0)'
    })) {
      expect(dark[name], name).toBe(value)
    }
  })

  it.each(palettes)('$name: button text reads on the fill', ({ tokens }) => {
    expect(
      contrastOf(tokens['--primary-foreground'], tokens['--primary'])
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps structural surfaces, ordinary hovers, text and charts in the base theme', () => {
    const structural = [
      '--background',
      '--foreground',
      '--card',
      '--card-foreground',
      '--popover',
      '--popover-foreground',
      '--secondary',
      '--secondary-foreground',
      '--muted',
      '--muted-foreground',
      '--accent',
      '--accent-foreground',
      '--border',
      '--input',
      '--sidebar',
      '--sidebar-foreground',
      '--sidebar-accent',
      '--sidebar-accent-foreground',
      '--sidebar-border',
      '--code',
      '--destructive',
      '--warning',
      '--chart-1',
      '--chart-2',
      '--chart-3',
      '--chart-4',
      '--chart-5'
    ]
    for (const tone of Object.keys(FILLS)) {
      for (const selector of [
        `[data-tone='${tone}']`,
        `.dark[data-tone='${tone}']`
      ]) {
        const overrides = block(selector)
        for (const name of structural)
          expect(overrides[name], `${selector} ${name}`).toBeUndefined()
        expect(overrides['--selected']).toContain('color-mix(')
      }
    }
  })

  it.each(palettes)(
    '$name: accent text reads on neutral surfaces and the message bubble',
    ({ tokens }) => {
      for (const surface of ['--background', '--card', '--muted', '--bubble']) {
        expect(
          contrastOf(tokens['--primary-ink'], tokens[surface])
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  )

  it.each(palettes.filter((palette) => !palette.name.startsWith('neutral')))(
    '$name: accent text reads in a tinted chip on a muted surface',
    ({ name, tokens }) => {
      const dark = name.endsWith('dark')
      const fill = tokens['--primary'].slice(1)
      const share = dark ? 0.3 : 0.2
      const base = dark ? 38 : 245
      const chip =
        '#' +
        [0, 2, 4]
          .map((offset) =>
            Math.round(
              base * (1 - share) +
                parseInt(fill.slice(offset, offset + 2), 16) * share
            )
              .toString(16)
              .padStart(2, '0')
          )
          .join('')
      expect(contrastOf(tokens['--primary-ink'], chip)).toBeGreaterThanOrEqual(
        4.5
      )
    }
  )

  // The composer's button is one of three: voice while the field is empty,
  // the arrow to send, a square to stop.
  const classesBefore = (file: string, anchor: string) => {
    const source = readFileSync(join(ROOT, file), 'utf8')
    const at = source.indexOf(anchor)
    return source
      .slice(source.lastIndexOf('className=', at), at)
      .split(/[\s"]/u)
  }

  it('draws the stop button neutral, its square white in light', () => {
    const classes = classesBefore(
      'src/renderer/components/chat/composer/composer-turn-button.tsx',
      "t('composer.stop')"
    )
    expect(classes).toContain('bg-foreground')
    expect(classes).toContain('text-background')
  })

  it.each(palettes)('$name: a message reads in its bubble', ({ tokens }) => {
    expect(
      contrastOf(tokens['--foreground'], tokens['--bubble'])
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('draws links in the tone', () => {
    const links = css.slice(css.indexOf(':scope :where(a) {'))
    expect(links.slice(0, links.indexOf('}'))).toContain(
      'color: var(--primary-ink)'
    )
  })
})

describe('a code block’s panel', () => {
  // A tone tints `--muted`; code on a tinted panel read as part of the
  // decoration (owner, 2026-10-08), so the panel has a token of its own that
  // only the two neutral schemes set.
  it('is neutral in every tone: --code is set by :root and .dark alone', () => {
    expect(block(':root')['--code']).toBe('oklch(0.97 0 0)')
    expect(block('.dark')['--code']).toBe('oklch(0.269 0 0)')
    for (const palette of palettes) {
      if (palette.name.startsWith('neutral')) continue
      expect(palette.tokens['--code'], palette.name).toBe(
        block(palette.name.endsWith('dark') ? '.dark' : ':root')['--code']
      )
    }
  })

  it('and its header strip both use it, never --muted', () => {
    expect(css).toMatch(/:scope :where\(pre\) \{\s*@apply bg-code /u)
    const markdown = readFileSync(
      join(ROOT, 'src/renderer/components/markdown/markdown.tsx'),
      'utf8'
    )
    expect(markdown).toContain('className="bg-code text-muted-foreground ')
    expect(markdown).not.toContain('className="bg-muted text-muted-foreground ')
  })
})

// The tone colours a conversation, not the page around it: a
// `data-tone-scope="neutral"` region (Philharmonic's pages) is drawn with the
// neutral tone's accents, and `data-tone-scope="tone"` inside it takes the
// chosen tone back (a group's transcript and composer).
describe('where the tone stops', () => {
  const neutralLight = block(`[data-tone-scope='neutral']`)
  const neutralDark = block(`.dark [data-tone-scope='neutral']`)
  const toned = block(`[data-tone-scope='tone']`)
  // The aliases sit in a `:root` block of their own, after the tones.
  const aliases = Object.fromEntries(
    [...css.matchAll(/(--toned-[\w-]+):\s*([^;]+);/gu)].map((m) => [m[1], m[2]])
  )

  it('is the neutral tone’s accents, light and dark', () => {
    for (const [name, value] of Object.entries(neutralLight)) {
      expect(value, name).toBe(block(':root')[name])
    }
    for (const [name, value] of Object.entries(neutralDark)) {
      expect(value, name).toBe(block('.dark')[name])
    }
    expect(Object.keys(neutralDark)).toEqual(Object.keys(neutralLight))
  })

  it('resets every accent a tone sets, and brings each one back', () => {
    // Each token a tone gives its fill, bubble, accent or ring.
    const accents = Object.keys(neutralLight)
    for (const name of [
      '--primary',
      '--primary-foreground',
      '--bubble',
      '--accent',
      '--ring',
      '--sidebar-primary'
    ]) {
      expect(accents, name).toContain(name)
    }
    expect(Object.keys(toned)).toEqual(accents)
    for (const name of accents) {
      const alias = `--toned-${name.slice(2)}`
      expect(toned[name], name).toBe(`var(${alias})`)
      expect(aliases[alias], alias).toBe(`var(${name})`)
    }
  })
})
