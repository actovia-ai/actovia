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
  ['circle', { cx: '12', cy: '8.2', r: '2.7', ...STROKE, key: '0' }],
  // Shoulders and arms, top edge: left hand to the baton hand.
  [
    'path',
    { d: 'M4.2 12.6c1.7 0 3.1-.4 4.5-.9h6.8l3.4-1.5', ...STROKE, key: '1' }
  ],
  // Bottom edge: under the left arm, the two legs, under the right arm.
  [
    'path',
    {
      d: 'M4.2 15.4c1.6.1 3.1-.5 4.6-1.6v8.2m2.4 0 .8-4.6.8 4.6m2.4 0v-7.4l3.6-1.2 1.6-1.2',
      ...STROKE,
      key: '2'
    }
  ],
  ['circle', { cx: '3', cy: '14', r: '1.3', ...STROKE, key: '3' }],
  ['circle', { cx: '20.3', cy: '11.4', r: '1.1', ...STROKE, key: '4' }],
  // Baton.
  ['path', { d: 'M20.8 10.3 22.3 3.2', ...STROKE, key: '5' }],
  // Two beamed eighth notes, top left; one, top right.
  ['path', { d: 'M3 5.2V2.4l3.6.5v2.8', ...STROKE, key: '6' }],
  ['circle', { cx: '2.3', cy: '5.4', r: '.7', ...STROKE, key: '7' }],
  ['circle', { cx: '5.9', cy: '5.9', r: '.7', ...STROKE, key: '8' }],
  ['path', { d: 'M17 4.6V2h1.4', ...STROKE, key: '9' }],
  ['circle', { cx: '16.3', cy: '4.8', r: '.7', ...STROKE, key: '10' }]
]
