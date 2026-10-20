// Ody the Traveller — the Actovia mascot, bindle on its shoulder, glancing
// toward the way out. The menu bar glyph is Ody's head alone.
//
// Every icon, splash and web asset is generated from these functions by
// scripts/render-icons.mjs; edit the art here, then run `bun run icons`.
// All art is drawn on a 1024 × 1024 canvas (the menu bar glyph on 16 × 16).

import { readFileSync } from 'node:fs'

import { blurs, lin, rad } from './lib.mjs'

export const PALETTE = {
  sun: '#FFD84A',
  marigold: '#FFAE1A',
  sunDark: '#2E2716',
  marigoldDark: '#141209',
  mallow: '#F6F2EC',
  bindle: '#E5392E',
  blush: '#FF7E95',
  ink: '#1B1B1F',
  // Splash / web surfaces
  paper: ['#FFF7DD', '#FFEDB8'],
  text: '#3A2A00',
  accent: '#E89A00'
}

// A gumdrop: a dome on a softly rounded base, feet at y = 850.
const BODY =
  'M232 800C232 480 330 250 512 250C694 250 792 480 792 800C792 836 770 850 730 850L294 850C254 850 232 836 232 800Z'

function bodyDefs(u) {
  return `${rad(
    `${u}body`,
    [
      [0, '#FFFFFF'],
      [0.5, PALETTE.mallow],
      [1, '#D3C8B8']
    ],
    0.36,
    0.26,
    0.85
  )}
  ${lin(`${u}rim`, [
    [0.5, '#7A5A2A', 0],
    [1, '#7A5A2A', 0.3]
  ])}`
}

// Looking right, toward the way out.
const EYES = `<g fill="${PALETTE.ink}"><ellipse cx="578" cy="522" rx="31" ry="60"/><ellipse cx="696" cy="522" rx="31" ry="60"/></g>
  <g fill="#fff"><circle cx="588" cy="494" r="10"/><circle cx="706" cy="494" r="10"/></g>`

// ── Layers ────────────────────────────────────────────────────────────────

/** Background: the sunflower gradient and its top glow. */
export function background(u, { dark = false } = {}) {
  const [a, b] = dark
    ? [PALETTE.sunDark, PALETTE.marigoldDark]
    : [PALETTE.sun, PALETTE.marigold]
  return `<defs>${blurs(u)}${lin(`${u}bg`, [
    [0, a],
    [1, b]
  ])}</defs>
  <rect width="1024" height="1024" fill="url(#${u}bg)"/>
  <ellipse cx="512" cy="110" rx="560" ry="290" fill="#fff" opacity="${dark ? 0.06 : 0.28}" filter="url(#${u}b44)"/>`
}

/** The soft contact shadow under Ody. */
export function shadow(u, { dark = false } = {}) {
  return `<defs>${blurs(u)}</defs>
  <ellipse cx="512" cy="858" rx="320" ry="44" fill="${dark ? '#000' : '#9A5A00'}" opacity="${dark ? 0.6 : 0.42}" filter="url(#${u}b24)"/>`
}

/** The bindle: a stick over the shoulder and a polka-dot bundle. Sits behind Ody. */
export function bindle(u) {
  return `<defs>${blurs(u)}
    ${rad(
      `${u}bun`,
      [
        [0, '#FF9A88'],
        [1, '#D8322A']
      ],
      0.35,
      0.3,
      0.8
    )}
    ${lin(`${u}stk`, [
      [0, '#9A6634'],
      [1, '#6A3E18']
    ])}</defs>
  <line x1="350" y1="592" x2="205" y2="340" stroke="url(#${u}stk)" stroke-width="26" stroke-linecap="round"/>
  <circle cx="190" cy="300" r="98" fill="url(#${u}bun)"/>
  <g fill="#fff" opacity=".9"><circle cx="150" cy="262" r="15"/><circle cx="214" cy="236" r="11"/><circle cx="232" cy="318" r="14"/><circle cx="158" cy="345" r="10"/><circle cx="190" cy="292" r="9"/><circle cx="118" cy="306" r="8"/></g>
  <ellipse cx="220" cy="392" rx="32" ry="17" transform="rotate(-40 220 392)" fill="#C42A23"/>
  <ellipse cx="258" cy="376" rx="32" ry="17" transform="rotate(28 258 376)" fill="#C42A23"/>
  <ellipse cx="156" cy="244" rx="34" ry="18" transform="rotate(-30 156 244)" fill="#fff" opacity=".45" filter="url(#${u}b4)"/>`
}

/**
 * Ody: body, face and the hand holding the stick. `part`: 'all', 'body'
 * (everything but the eyes) or 'eyes' — the boot splash blinks the eyes on a
 * layer of their own. `shadow` adds the contact shadow underneath.
 */
export function character(
  u,
  { dark = false, shadow: withShadow = true, part = 'all' } = {}
) {
  if (part === 'eyes') return EYES
  return `${withShadow ? shadow(`${u}s`, { dark }) : ''}<defs>${blurs(u)}${bodyDefs(u)}</defs>
  <path d="${BODY}" fill="url(#${u}body)"/>
  <path d="${BODY}" fill="url(#${u}rim)"/>
  <ellipse cx="398" cy="372" rx="84" ry="42" transform="rotate(-38 398 372)" fill="#fff" filter="url(#${u}b14)"/>
  <ellipse cx="352" cy="604" rx="46" ry="34" fill="#6A4A1A" opacity=".22" filter="url(#${u}b8)"/>
  <ellipse cx="346" cy="592" rx="46" ry="36" fill="url(#${u}body)"/>
  ${part === 'all' ? EYES : ''}
  <g fill="${PALETTE.blush}" opacity=".5" filter="url(#${u}b4)"><ellipse cx="520" cy="640" rx="36" ry="17"/><ellipse cx="742" cy="636" rx="30" ry="16"/></g>
  <path d="M618 610q22 20 44 0" fill="none" stroke="${PALETTE.ink}" stroke-width="11" stroke-linecap="round"/>`
}

/** Full-bleed square icon (what iOS and Icon Composer's preview expect). */
export function icon(u, { dark = false } = {}) {
  return `${background(`${u}g`, { dark })}${shadow(`${u}s`, { dark })}${bindle(`${u}b`)}${character(`${u}c`, { dark, shadow: false })}`
}

/** iOS 18+ tinted variant: a greyscale foreground on black. */
export function tinted(u) {
  return `<defs><filter id="${u}grey"><feColorMatrix type="saturate" values="0"/></filter></defs>
  <rect width="1024" height="1024" fill="#000"/>
  <g filter="url(#${u}grey)">${bindle(`${u}b`)}${character(`${u}c`, { dark: true })}</g>`
}

/** Layers for Apple's Icon Composer, bottom to top. */
export function composerLayers() {
  return {
    background: background('bg'),
    'background-dark': background('bd', { dark: true }),
    bindle: bindle('bn'),
    ody: character('o', { shadow: false })
  }
}

// ── Menu bar ──────────────────────────────────────────────────────────────

/**
 * Template glyph on a 16 × 16 grid, black on transparent: Ody's head leaning
 * in from the corner (the menu bar keeps the "peekaboo" pose — a head reads
 * better than the full figure at 22 pt).
 */
export function glyph(u) {
  const egg =
    'M8 2.4C11.3 2.4 13.9 6.1 13.9 9.9C13.9 13.6 11.4 16.4 8 16.4C4.6 16.4 2.1 13.6 2.1 9.9C2.1 6.1 4.7 2.4 8 2.4Z'
  return `<mask id="${u}m" maskUnits="userSpaceOnUse" x="-8" y="-8" width="32" height="32"><rect x="-8" y="-8" width="32" height="32" fill="#fff"/><ellipse cx="5.3" cy="8.4" rx=".85" ry="1.55" fill="#000"/><ellipse cx="7.6" cy="8.4" rx=".85" ry="1.55" fill="#000"/><ellipse cx="6.5" cy="10.9" rx=".5" ry=".6" fill="#000"/></mask>
  <g transform="translate(11.2 18.2) rotate(-20) scale(1.22) translate(-8 -14.2)"><path d="${egg}" mask="url(#${u}m)"/></g>
  <g stroke="#000" stroke-width="1.1" stroke-linecap="round"><path d="M2.6 3.6L1.4 2.6"/><path d="M2 5.8H.6"/></g>`
}

/**
 * The tray's viewBox: the glyph (y 2.6–16, cropped flat at the bottom)
 * centred in the 22-pt item like every other menu bar icon.
 */
export const GLYPH_VIEWBOX = '-1.2 -0.2 19 19'

// ── Boot splash (index.html) ──────────────────────────────────────────────

/**
 * The markup + CSS that index.html paints before any JS has loaded. The
 * shadow, bindle, body and eyes are separate layers so each can move, and
 * every animation is transform/opacity only: those run on the compositor,
 * so they keep going while the main thread is busy evaluating the module
 * graph (exactly when this splash is on screen).
 */
export function bootSplash() {
  const layer = (cls, body) =>
    `<div class="${cls}"><svg viewBox="0 0 1024 1024" width="100%" height="100%">${body}</svg></div>`
  const html = `<div id="boot-splash" aria-hidden="true">
        <div class="bs-icon">
          ${layer('bs-layer', background('bsb'))}
          <div class="bs-layer bs-enter">
            ${layer('bs-layer bs-shadow', shadow('bss'))}
            <div class="bs-layer bs-hop">
              ${layer('bs-layer bs-bindle', bindle('bsn'))}
              ${layer('bs-layer', character('bso', { part: 'body', shadow: false }))}
              ${layer('bs-layer bs-eyes', character('bse', { part: 'eyes' }))}
            </div>
          </div>
        </div>
        <div class="bs-dots"><i></i><i></i><i></i></div>
      </div>`
  const css = `#boot-splash {
        position: fixed;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 22px;
      }
      #boot-splash .bs-icon {
        position: relative;
        width: 96px;
        height: 96px;
        border-radius: 22.4%;
        overflow: hidden;
        box-shadow: 0 8px 24px rgb(0 0 0 / 16%), 0 1px 2px rgb(0 0 0 / 12%);
        animation: bs-rise 500ms cubic-bezier(0.23, 1, 0.32, 1) both;
      }
      #boot-splash .bs-layer {
        position: absolute;
        inset: 0;
      }
      /* The bundle swings past its layer's box; the icon's rounded clip
         trims what leaves the icon, so the layers must not clip. */
      #boot-splash svg {
        display: block;
        overflow: visible;
      }
      /* Ody walks in from the left, then keeps hopping on the spot with the
         bundle swinging, and the shadow shrinking as it leaves the ground. */
      #boot-splash .bs-enter {
        animation: bs-walk-in 700ms 120ms cubic-bezier(0.23, 1, 0.32, 1) both;
      }
      #boot-splash .bs-hop {
        animation: bs-hop 1100ms 820ms cubic-bezier(0.77, 0, 0.175, 1) infinite;
      }
      #boot-splash .bs-shadow {
        transform-origin: 50% 84%;
        animation: bs-shadow 1100ms 820ms cubic-bezier(0.77, 0, 0.175, 1) infinite;
      }
      #boot-splash .bs-bindle {
        transform-origin: 34% 58%;
        animation: bs-swing 1100ms 820ms cubic-bezier(0.77, 0, 0.175, 1) infinite;
      }
      #boot-splash .bs-eyes {
        transform-origin: 62% 51%;
        animation: bs-blink 3600ms 1400ms infinite;
      }
      #boot-splash .bs-dots {
        display: flex;
        gap: 6px;
      }
      #boot-splash .bs-dots i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: oklch(0.556 0 0);
        animation: bs-dot 1200ms cubic-bezier(0.77, 0, 0.175, 1) infinite both;
      }
      #boot-splash .bs-dots i:nth-child(2) { animation-delay: 150ms; }
      #boot-splash .bs-dots i:nth-child(3) { animation-delay: 300ms; }
      @keyframes bs-rise {
        from { opacity: 0; transform: translateY(6px) scale(0.96); }
      }
      @keyframes bs-walk-in {
        from { transform: translateX(-38%); }
      }
      @keyframes bs-hop {
        0%, 100% { transform: none; }
        45% { transform: translateY(-5%); }
      }
      @keyframes bs-shadow {
        0%, 100% { transform: none; opacity: 1; }
        45% { transform: scaleX(0.82); opacity: 0.6; }
      }
      @keyframes bs-swing {
        0%, 100% { transform: rotate(-3deg); }
        50% { transform: rotate(5deg); }
      }
      @keyframes bs-blink {
        0%, 92%, 100% { transform: none; }
        95% { transform: scaleY(0.12); }
      }
      @keyframes bs-dot {
        0%, 100% { opacity: 0.25; transform: none; }
        40% { opacity: 0.9; transform: translateY(-3px); }
      }
      @media (prefers-color-scheme: dark) {
        #boot-splash .bs-dots i { background: oklch(0.708 0 0); }
      }
      @media (prefers-reduced-motion: reduce) {
        #boot-splash .bs-icon,
        #boot-splash .bs-enter,
        #boot-splash .bs-hop,
        #boot-splash .bs-shadow,
        #boot-splash .bs-bindle { animation: none; }
        #boot-splash .bs-dots i { transform: none; }
      }`
  return { html, css }
}

// ── DMG window (build/dmg-background.png) ─────────────────────────────────

/** The installer window in points and the icons' centres; forge.config.ts reads the same file. */
export const DMG = JSON.parse(
  readFileSync(new URL('./dmg.json', import.meta.url), 'utf8')
)

/**
 * The DMG window's background: the web surfaces' paper, a dashed arc from the
 * app to Applications, and one line saying what to do. Finder draws the two
 * icons and their labels on top, centred on DMG.app / DMG.apps. The paper
 * runs left to right only: Finder on macOS 26 makes the window a little
 * taller than the image and tiles it, so the top and bottom rows must match.
 */
export function dmgBackground(scale = 1) {
  const { width: w, height: h, app, apps } = DMG
  const [a, b] = PALETTE.paper
  const y = app[1] - 4
  const x1 = app[0] + 92
  const x2 = apps[0] - 92
  const mid = (x1 + x2) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}">
    <defs>
      ${lin(
        'dmgp',
        [
          [0, a],
          [1, b]
        ],
        0,
        0,
        1,
        0
      )}
      ${rad('dmgg', [
        [0, '#FFFFFF', 0.7],
        [1, '#FFFFFF', 0]
      ])}
    </defs>
    <rect width="${w}" height="${h}" fill="url(#dmgp)"/>
    <ellipse cx="${app[0]}" cy="${app[1]}" rx="120" ry="110" fill="url(#dmgg)"/>
    <ellipse cx="${apps[0]}" cy="${apps[1]}" rx="120" ry="110" fill="url(#dmgg)"/>
    <g fill="none" stroke="${PALETTE.accent}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity=".75">
      <path d="M${x1} ${y} Q${mid} ${y - 34} ${x2} ${y}" stroke-dasharray="1 10"/>
      <path d="M${x2 - 13} ${y - 10} L${x2} ${y} L${x2 - 15} ${y + 5}"/>
    </g>
    <text x="${w / 2}" y="${h - 52}" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="500" font-size="17" fill="${PALETTE.text}" fill-opacity=".6">Drag Actovia into Applications</text>
  </svg>`
}
