/**
 * Chat's and Philharmonic's sidebars are drawn on the window's own material
 * (vibrancy): transparent, with a translucent row highlight that reads on it.
 */
export const SIDEBAR_ON_MATERIAL =
  'border-none bg-transparent [--sidebar-accent:rgb(0_0_0/0.05)] dark:[--sidebar-accent:rgb(255_255_255/0.07)]'

/**
 * Settings' sidebar is solid, not on the material (owner, ISSUE-269), and a
 * step deeper than `--sidebar`, which read too light beside the page
 * (ISSUE-236): the tone's own `--sidebar` mixed toward black, so it keeps the
 * tone's hue, with the active row deepened to stay as far below it.
 */
export const SIDEBAR_SOLID =
  'border-none bg-[color-mix(in_oklch,var(--sidebar),black_4%)] [--sidebar-accent:color-mix(in_oklch,var(--sidebar),black_8%)] dark:bg-[color-mix(in_oklch,var(--sidebar),black_15%)] dark:[--sidebar-accent:color-mix(in_oklch,var(--sidebar),white_8%)]'
