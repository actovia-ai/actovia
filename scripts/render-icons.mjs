#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Render every Actovia icon, the tray glyph, web assets and the boot splash
// from brand/art.mjs. Run with `bun run icons` after editing the art.
//
//   build/      icon.icns, icon.icon, icon-dock.png, icon.ico, icon.png, <n>x<n>.png,
//               dmg-background{,@2x}.png
//   resources/  icon.png, trayTemplate{,@2x,@3x}.png   (shipped with the app)
//   brand/      svg/, icon-composer/, ios/, web/
//   src/renderer/assets/images/logo-{light,dark}.png   (Settings → About)
//   index.html  the boot splash, between its boot-splash markers
//
// The macOS .icns and the dev Dock icon come from brand/liquid-glass/light.png
// (an Icon Composer export) when it exists, otherwise from the flat art.
//
// Uses Playwright's Chromium (already a dev dependency for e2e) and falls
// back to an installed Chrome, then `iconutil` (macOS) for the .icns.
import { chromium } from '@playwright/test'

import * as m from '../brand/art.mjs'
import { framed, svg } from '../brand/lib.mjs'

const root = resolve(new URL('..', import.meta.url).pathname)
const out = (...p) => {
  const file = join(root, ...p)
  mkdirSync(join(file, '..'), { recursive: true })
  return file
}
const rel = (file) => file.slice(root.length + 1)

// ── Browser ───────────────────────────────────────────────────────────────

const fallbacks = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
]
const bundled = chromium.executablePath()
const executablePath = existsSync(bundled)
  ? undefined
  : fallbacks.find((p) => existsSync(p))
if (!existsSync(bundled) && !executablePath) {
  console.error(
    'No Chromium found. Run `bunx playwright install chromium` or install Chrome.'
  )
  process.exit(1)
}
const browser = await chromium.launch({ executablePath })
const page = await browser.newPage()

const fontData = readFileSync(join(root, 'brand/fonts/Fredoka.ttf')).toString(
  'base64'
)
const FONT = `@font-face{font-family:Fredoka;src:url(data:font/ttf;base64,${fontData}) format("truetype");font-weight:300 700}`

/** Render markup at exactly w × h CSS pixels and return the PNG bytes. */
async function shoot(markup, w, h = w, { opaque = false } = {}) {
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(
    `<!doctype html><style>${FONT}html,body{margin:0;background:transparent}svg,img{display:block}</style>${markup}`
  )
  await page.evaluate(() => document.fonts.ready)
  return page.screenshot({
    omitBackground: !opaque,
    clip: { x: 0, y: 0, width: w, height: h }
  })
}

async function png(file, markup, w, h = w, opts) {
  writeFileSync(file, await shoot(markup, w, h, opts))
  console.log(`✓ ${rel(file)} (${w}×${h})`)
}

/** App Store Connect rejects an iOS icon with an alpha channel. */
function dropAlpha(file) {
  const tmp = `${file}.jpg`
  execFileSync(
    'sips',
    ['-s', 'format', 'jpeg', '-s', 'formatOptions', '100', file, '--out', tmp],
    { stdio: 'pipe' }
  )
  execFileSync('sips', ['-s', 'format', 'png', tmp, '--out', file], {
    stdio: 'pipe'
  })
  rmSync(tmp)
}

/** Windows .ico with PNG-encoded entries (supported since Vista). */
function writeIco(file, entries) {
  const header = Buffer.alloc(6 + entries.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = header.length
  entries.forEach(({ size, data }, i) => {
    const at = 6 + i * 16
    header.writeUInt8(size >= 256 ? 0 : size, at)
    header.writeUInt8(size >= 256 ? 0 : size, at + 1)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(data.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  writeFileSync(file, Buffer.concat([header, ...entries.map((e) => e.data)]))
  console.log(`✓ ${rel(file)} (${entries.map((e) => e.size).join(', ')})`)
}

const iosEntry = (filename, appearance) => ({
  ...(appearance
    ? { appearances: [{ appearance: 'luminosity', value: appearance }] }
    : {}),
  filename,
  idiom: 'universal',
  platform: 'ios',
  size: '1024x1024'
})

const between = (text, open, close, body) => {
  const a = text.indexOf(open)
  const b = text.indexOf(close, a)
  if (a < 0 || b < 0) throw new Error(`index.html: missing ${open} … ${close}`)
  const start = text.indexOf('\n', a) + 1
  return text.slice(0, start) + body + text.slice(b)
}

// ── Masters ───────────────────────────────────────────────────────────────

const iconLight = svg(m.icon('l'))
const iconDark = svg(m.icon('d', { dark: true }))
const macosFlat = svg(framed('m', m.icon))
// Other desktops: a small margin, no drop shadow.
const desktop = svg(framed('w', m.icon, { inset: 24, shadow: false }))
// Favicons and PWA icons: the squircle edge to edge.
const rounded = svg(framed('r', m.icon, { inset: 0, shadow: false }))
// Tray: the 16-pt glyph, framed by GLYPH_VIEWBOX and clipped to its box.
const tray = (size) =>
  svg(
    `<defs><clipPath id="tc"><rect width="16" height="16"/></clipPath></defs><g clip-path="url(#tc)">${m.glyph('t')}</g>`,
    size,
    size,
    m.GLYPH_VIEWBOX
  )

writeFileSync(out('brand/svg/icon.svg'), iconLight)
writeFileSync(out('brand/svg/icon-dark.svg'), iconDark)
writeFileSync(out('brand/svg/icon-macos.svg'), macosFlat)
writeFileSync(out('brand/svg/icon-desktop.svg'), desktop)
writeFileSync(out('brand/svg/tray-template.svg'), tray(22))
console.log('✓ brand/svg/*.svg')

// ── macOS ─────────────────────────────────────────────────────────────────
// The Icon Composer export when there is one, on Apple's grid (an 824 body
// inside 1024, with a drop shadow); otherwise the flat art.

const glass = join(root, 'brand/liquid-glass/light.png')
const hasGlass = existsSync(glass)
const glassSrc = hasGlass
  ? `data:image/png;base64,${readFileSync(glass).toString('base64')}`
  : ''
const macosAt = (size) => {
  if (!hasGlass) return macosFlat
  const k = size / 1024
  return `<img src="${glassSrc}" style="position:absolute;left:${100 * k}px;top:${100 * k}px;width:${824 * k}px;height:${824 * k}px;filter:drop-shadow(0 ${10 * k}px ${10 * k}px rgb(0 0 0 / 30%))">`
}
const iconset = join(
  mkdtempSync(join(tmpdir(), 'actovia-icon-')),
  'icon.iconset'
)
mkdirSync(iconset)
for (const base of [16, 32, 128, 256, 512]) {
  writeFileSync(
    join(iconset, `icon_${base}x${base}.png`),
    await shoot(macosAt(base), base)
  )
  writeFileSync(
    join(iconset, `icon_${base}x${base}@2x.png`),
    await shoot(macosAt(base * 2), base * 2)
  )
}
// The same art as a PNG for the Dock of a dev run (src/main/lib/dock-icon.ts):
// nativeImage cannot read .icns.
await png(out('build/icon-dock.png'), macosAt(1024), 1024)
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', out('build/icon.icns')])
rmSync(join(iconset, '..'), { recursive: true, force: true })
console.log(
  `✓ build/icon.icns (16–1024, @1x/@2x${hasGlass ? ', from liquid-glass/light.png' : ''})`
)

// ── In-app logo (Settings → About) ────────────────────────────────────────
// The Liquid Glass exports, light and dark, at 256 px (a 2x of the 128 px
// the page shows at most) — the 1024 originals are ~2 MB each.

for (const mode of ['light', 'dark']) {
  const src = join(root, `brand/liquid-glass/${mode}.png`)
  const markup = existsSync(src)
    ? `<img src="data:image/png;base64,${readFileSync(src).toString('base64')}" width="256" height="256">`
    : svg(
        framed('a', m.icon, { inset: 0, shadow: false, dark: mode === 'dark' }),
        256,
        256,
        '0 0 1024 1024'
      )
  await png(out(`src/renderer/assets/images/logo-${mode}.png`), markup, 256)
}

// ── Windows / Linux ───────────────────────────────────────────────────────

const icoEntries = []
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  const data = await shoot(desktop, size)
  writeFileSync(out(`build/${size}x${size}.png`), data)
  if (size <= 256) icoEntries.push({ size, data })
}
console.log('✓ build/<n>x<n>.png (16–1024)')
writeIco(out('build/icon.ico'), icoEntries)
await png(out('build/icon.png'), desktop, 1024)
await png(out('resources/icon.png'), desktop, 512)

// ── Menu bar (template image: black + alpha, 22 pt) ───────────────────────

await png(out('resources/trayTemplate.png'), tray(22), 22)
await png(out('resources/trayTemplate@2x.png'), tray(44), 44)
await png(out('resources/trayTemplate@3x.png'), tray(66), 66)

// ── Icon Composer layers ──────────────────────────────────────────────────
// Icon Composer adds its own shadows and glass, so Ody goes in without the
// contact shadow.

for (const [name, body] of Object.entries(m.composerLayers())) {
  writeFileSync(out(`brand/icon-composer/${name}.svg`), svg(body))
  await png(out(`brand/icon-composer/${name}.png`), svg(body), 1024)
}

// ── Icon Composer document → build/icon.icon ──────────────────────────────
// brand/Actovia.icon is the Icon Composer document (the composition: layer
// order, glass, shadow, the dark-appearance background). Refresh its layer
// SVGs from the ones just rendered, then hand forge a copy: @electron/packager
// compiles build/icon.icon with actool (macOS 26 + Xcode 26) into Assets.car,
// which macOS 26 uses to follow the icon style (light / dark / clear / tinted);
// older macOS keeps using build/icon.icns.

const iconDoc = join(root, 'brand/Actovia.icon')
if (existsSync(iconDoc)) {
  for (const f of readdirSync(join(iconDoc, 'Assets'))) {
    const fresh = join(root, 'brand/icon-composer', f)
    if (existsSync(fresh)) cpSync(fresh, join(iconDoc, 'Assets', f))
  }
  rmSync(join(root, 'build/icon.icon'), { recursive: true, force: true })
  cpSync(iconDoc, join(root, 'build/icon.icon'), { recursive: true })
  console.log('✓ build/icon.icon (from brand/Actovia.icon)')
}

// ── iOS ───────────────────────────────────────────────────────────────────

const appiconset = 'brand/ios/AppIcon.appiconset'
for (const [name, markup] of [
  ['AppIcon.png', iconLight],
  ['AppIcon-Dark.png', iconDark],
  ['AppIcon-Tinted.png', svg(m.tinted('t'))]
]) {
  const file = out(appiconset, name)
  await png(file, markup, 1024, 1024, { opaque: true })
  dropAlpha(file)
}
writeFileSync(
  out(appiconset, 'Contents.json'),
  `${JSON.stringify(
    {
      images: [
        iosEntry('AppIcon.png'),
        iosEntry('AppIcon-Dark.png', 'dark'),
        iosEntry('AppIcon-Tinted.png', 'tinted')
      ],
      info: { author: 'xcode', version: 1 }
    },
    null,
    2
  )}\n`
)
console.log(`✓ ${appiconset}/Contents.json`)

// ── Web ───────────────────────────────────────────────────────────────────

writeFileSync(out('brand/web/favicon.svg'), rounded)
const favs = []
for (const size of [16, 32, 48])
  favs.push({ size, data: await shoot(rounded, size) })
writeIco(out('brand/web/favicon.ico'), favs)
await png(out('brand/web/apple-touch-icon.png'), iconLight, 180, 180, {
  opaque: true
})
await png(out('brand/web/icon-192.png'), rounded, 192)
await png(out('brand/web/icon-512.png'), rounded, 512)
await png(out('brand/web/icon-maskable-512.png'), iconLight, 512, 512, {
  opaque: true
})
writeFileSync(
  out('brand/web/site.webmanifest'),
  `${JSON.stringify(
    {
      name: 'Actovia',
      short_name: 'Actovia',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        {
          src: '/icon-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable'
        }
      ],
      theme_color: m.PALETTE.accent,
      background_color: m.PALETTE.paper[0],
      display: 'standalone'
    },
    null,
    2
  )}\n`
)
console.log('✓ brand/web/site.webmanifest')

const [a, b] = m.PALETTE.paper
await png(
  out('brand/web/og-image.png'),
  `<div style="width:1200px;height:630px;display:grid;place-items:center;background:linear-gradient(160deg,${a},${b});color:${m.PALETTE.text};font-family:Fredoka,sans-serif">
    <div style="display:grid;justify-items:center;gap:31px">
      <div style="width:220px;height:220px;filter:drop-shadow(0 14px 28px rgba(0,0,0,.18))">${svg(framed('s', m.icon, { inset: 0, shadow: false }), 220, 220, '0 0 1024 1024')}</div>
      <div style="font-weight:600;font-size:104px;line-height:1;letter-spacing:-.01em">Actovia</div>
      <div style="font-weight:500;font-size:34px;opacity:.65">Every model, on your own machine</div>
    </div></div>`,
  1200,
  630,
  { opaque: true }
)

// ── DMG window (maker-dmg in forge.config.ts) ─────────────────────────────
// appdmg merges foo.png + foo@2x.png into one Retina background by itself.

for (const scale of [1, 2]) {
  await png(
    out(`build/dmg-background${scale === 2 ? '@2x' : ''}.png`),
    m.dmgBackground(scale),
    m.DMG.width * scale,
    m.DMG.height * scale,
    { opaque: true }
  )
}

await browser.close()

// ── Boot splash (index.html) ──────────────────────────────────────────────

const splash = m.bootSplash()
const indexFile = join(root, 'index.html')
let index = readFileSync(indexFile, 'utf8')
index = between(
  index,
  '/* boot-splash:start',
  '      /* boot-splash:end */',
  `      ${splash.css}\n`
)
index = between(
  index,
  '<!-- boot-splash:start -->',
  '      <!-- boot-splash:end -->',
  `      ${splash.html}\n`
)
index = index.replace(
  /\/\* boot-splash:start[^*]*\*\//u,
  '/* boot-splash:start — generated by `bun run icons` (brand/art.mjs) */'
)
writeFileSync(indexFile, index)
// Leave it the way the pre-commit formatter would, so `fmt:check` stays green.
execFileSync(join(root, 'node_modules/.bin/oxfmt'), [indexFile], {
  stdio: 'pipe'
})
console.log('✓ index.html (boot splash)')
