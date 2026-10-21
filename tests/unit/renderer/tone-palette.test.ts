// The colour tones (Settings → General → Color tone). The accents are the
// owner's reference — ChatGPT's accent colours, 2026-09-29 — and the same
// ones actovia-ios draws; they are softer and lighter than a colour that can
// carry text, so a tone has a fill (`--primary`) and an ink
// (`--primary-ink`).
import { readdirSync, readFileSync, statSync } from 'fs'
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
    { name: `${tone}, light`, tokens: block(`[data-tone='${tone}']`) },
    { name: `${tone}, dark`, tokens: block(`.dark[data-tone='${tone}']`) }
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

  it('neutral is shadcn’s black and white', () => {
    expect(block(':root')['--primary']).toBe('oklch(0.205 0 0)')
    expect(block('.dark')['--primary']).toBe('oklch(0.922 0 0)')
  })

  it.each(palettes)('$name: the ink carries text on the page', ({ tokens }) => {
    expect(
      contrastOf(tokens['--primary-ink'], tokens['--background'])
    ).toBeGreaterThanOrEqual(4.5)
  })

  it.each(palettes)('$name: a glyph reads on the fill', ({ tokens }) => {
    // A glyph or a button's label on the accent: 3:1, the floor for
    // graphics and large text. The softer fills cannot give white more.
    expect(
      contrastOf(tokens['--primary-foreground'], tokens['--primary'])
    ).toBeGreaterThanOrEqual(3)
  })

  // A hover, a chip or a selected row is `--accent` / `--sidebar-accent`; a
  // light accent equal to `--muted` vanished on a muted card, and the active
  // sidebar row at 0.97 on 0.975 was 1.01:1 (2026-10-21). Each stays a
  // visible step from the surface it sits on.
  const lightnessOf = (value: string) => {
    const m = /^oklch\(\s*([\d.]+)\s/u.exec(value)
    if (!m) throw new Error(`not an opaque oklch: ${value}`)
    return Number(m[1])
  }
  it.each(palettes)('$name: the accent is a step from muted', ({ tokens }) => {
    expect(
      Math.abs(lightnessOf(tokens['--accent']) - lightnessOf(tokens['--muted']))
    ).toBeGreaterThanOrEqual(0.03 - 1e-9)
  })
  it.each(palettes.filter((p) => p.name.endsWith('light')))(
    '$name: the active sidebar row shows on the sidebar',
    ({ tokens }) => {
      expect(
        lightnessOf(tokens['--sidebar']) -
          lightnessOf(tokens['--sidebar-accent'])
      ).toBeGreaterThanOrEqual(0.035 - 1e-9)
    }
  )

  it.each(palettes.filter((p) => p.name.endsWith('light')))(
    '$name: send is a white arrow on the ink',
    ({ tokens }) => {
      // In light mode the send button is the tone's ink with a white arrow:
      // a white arrow on the soft fill is 1.6:1 in yellow.
      expect(
        contrastOf('oklch(1 0 0)', tokens['--primary-ink'])
      ).toBeGreaterThanOrEqual(4.5)
    }
  )

  // The composer's button is one of three: voice while the field is empty,
  // the arrow to send, a square to stop. In light mode each has a white
  // glyph — voice and send on the tone's ink, stop on the neutral disc.
  const classesBefore = (file: string, anchor: string) => {
    const source = readFileSync(join(ROOT, file), 'utf8')
    const at = source.indexOf(anchor)
    return source
      .slice(source.lastIndexOf('className=', at), at)
      .split(/[\s"]/u)
  }

  it.each([
    [
      'voice',
      'src/renderer/components/chat/composer/audio-recorder.tsx',
      'aria-label={'
    ],
    [
      'send',
      'src/renderer/components/chat/composer/composer-turn-button.tsx',
      "t('composer.send')"
    ]
  ])(
    'draws the %s button on the ink with a white glyph',
    (_name, file, anchor) => {
      const classes = classesBefore(file, anchor)
      for (const cls of [
        'bg-primary-ink',
        'text-white',
        'dark:bg-primary',
        'dark:text-primary-foreground'
      ]) {
        expect(classes, cls).toContain(cls)
      }
    }
  )

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

  it('draws links in the ink', () => {
    const links = css.slice(css.indexOf(':scope :where(a) {'))
    expect(links.slice(0, links.indexOf('}'))).toContain(
      'color: var(--primary-ink)'
    )
  })
})

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(tsx?|css)$/u.test(name) ? [path] : []
  })
}

describe('text in the tone’s colour', () => {
  it('is written in the ink, never in the fill', () => {
    // `text-primary` is the fill as a text colour: yellow on white is 1.6:1.
    // A regenerated shadcn primitive brings it back — change it there too.
    const offenders = sources(join(ROOT, 'src/renderer')).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /(?<![\w-])text-primary(?![\w-])/u.test(line)
            ? [`${path.slice(ROOT.length + 1)}:${i + 1}`]
            : []
        )
    )
    expect(offenders).toEqual([])
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
      expect(palette.tokens['--code'], palette.name).toBeUndefined()
    }
  })

  it('and its header strip both use it, never --muted', () => {
    expect(css).toMatch(/:scope :where\(pre\) \{\s*@apply bg-code /u)
    const markdown = readFileSync(
      join(ROOT, 'src/renderer/components/markdown/markdown.tsx'),
      'utf8'
    )
    expect(markdown).toContain(
      'className="bg-code text-muted-foreground sticky'
    )
    expect(markdown).not.toContain('bg-muted text-muted-foreground sticky')
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
    // Each token a tone gives its fill, ink, bubble, accent or ring.
    const accents = Object.keys(neutralLight)
    for (const name of [
      '--primary',
      '--primary-foreground',
      '--primary-ink',
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
