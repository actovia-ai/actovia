import type { IconSvgElement } from '@hugeicons/react'

/**
 * A conductor mid-gesture — raised baton, open arms, notes in the air.
 * Re-traced from Streamline Ultimate's "Music Conductor" (ISSUE-266) onto a
 * 24×24 grid, in the
 * shape Hugeicons' own icons take, so `<HugeiconsIcon icon={MusicConductor} />`
 * draws it like any of them (size, colour, stroke width from the props).
 *
 * Each element carries its own stroke, as the library's icons do: the wrapper
 * only strokes when given a `strokeWidth`, and the call sites no longer pass
 * one — without these the glyph drew nothing.
 *
 * Used as the Philharmonic workspace glyph.
 */
const STROKE = {
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  strokeWidth: '1.5'
} as const

export const MusicConductor: IconSvgElement = [
  // Head, with a parting across it.
  ['circle', { cx: '11.9', cy: '8', r: '3.2', ...STROKE, key: '0' }],
  ['path', { d: 'M8.9 7c1.8-.3 4-.1 5.9.6', ...STROKE, key: '1' }],
  // Shoulders and arms, top edge: left hand to the baton hand.
  [
    'path',
    { d: 'M3.8 12.4c1.8.1 3.3-.3 4.8-.8h8.4l2.6-1.2', ...STROKE, key: '2' }
  ],
  // Bottom edge: under the left arm, the two legs, under the right arm.
  [
    'path',
    {
      d: 'M3.8 15.3c1.7.2 3.4-.4 5-1.7l-.1 8.9m2.5 0 .7-4.8.8 4.8m2.3 0 .3-7.6 3.3-.8 2.6-1.8',
      ...STROKE,
      key: '3'
    }
  ],
  ['circle', { cx: '2.8', cy: '13.9', r: '1.3', ...STROKE, key: '4' }],
  ['circle', { cx: '20.4', cy: '11.3', r: '1.1', ...STROKE, key: '5' }],
  // Baton.
  ['path', { d: 'M20.7 10.2 22.2 2.8', ...STROKE, key: '6' }],
  // Two beamed eighth notes, top left; one, top right.
  ['path', { d: 'M2.6 5V2.6l4.2.4v3', ...STROKE, key: '7' }],
  ['circle', { cx: '1.9', cy: '5.1', r: '.8', ...STROKE, key: '8' }],
  ['circle', { cx: '6.1', cy: '6', r: '.8', ...STROKE, key: '9' }],
  ['path', { d: 'M18.1 4.6V1.9h1.6', ...STROKE, key: '10' }],
  ['circle', { cx: '17.4', cy: '4.8', r: '.8', ...STROKE, key: '11' }]
]
