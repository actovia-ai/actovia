import { createCn } from 'cn/config'

/**
 * The app's one `cn` — shadcn's (`cn` on npm), told the type scale's own
 * sizes (globals.css): without them it reads `text-ui` as a colour and drops
 * it beside `text-muted-foreground`. `components/ui/*` import `'cn'` as the
 * generator writes it; Vite and Vitest alias that bare specifier here.
 */
export const cn = createCn({ extend: { theme: { text: ['2xs', 'ui'] } } })
