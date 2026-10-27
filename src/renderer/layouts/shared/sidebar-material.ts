/**
 * A main-window sidebar is drawn on the window's own material (vibrancy):
 * transparent, with a translucent row highlight that reads on it. Chat's,
 * Philharmonic's and Settings' sidebars all use it, so none is lighter than
 * the others (ISSUE-236: Settings' was the solid `--sidebar` fill).
 */
export const SIDEBAR_ON_MATERIAL =
  'border-none bg-transparent [--sidebar-accent:rgb(0_0_0/0.05)] dark:[--sidebar-accent:rgb(255_255_255/0.07)]'
