import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import { v4 as uuidV4 } from 'uuid'

import { saveArtifact } from '../artifacts'

const createArtifactSchema = Type.Object({
  title: Type.String({
    description: 'Short title for the artifact (shown in the card header)'
  }),
  code: Type.String({
    description: `Write a self-contained React component in TSX using CommonJS require(). It appears in a browser-chrome card on desktop and may also open full-screen on a phone.

DESIGN
Make the visual form serve this content. Choose a fitting composition, typography, spacing, palette, and level of detail instead of defaulting to a dashboard or repeating the same card template. Use shadcn components when they help; plain HTML, CSS, SVG, and custom components are equally welcome. The artifact can have its own visual identity and need not match Actovia's accent tone.

Keep text readable and controls understandable. Make interactive states visible and keyboard operable. Respect reduced motion. Avoid decorative motion that distracts from the content.

THEME
The sandbox toggles .dark on <html> and sends theme changes to the frame. Support both light and dark. You can use Actovia's --background, --foreground, --card, --popover, --border, --muted-foreground, and --primary tokens as a convenient starting point, or define a small artifact-specific palette with CSS custom properties and .dark overrides. Don't make the whole artifact depend on the user's accent color. For charts, use colors that distinguish the data clearly; use var(--chart-1) … var(--chart-5) when those semantic series colors fit. Check text and data contrast in both themes. Inline styles may use CSS variables.

AVAILABLE IMPORTS (these are the only external modules the sandbox provides):
- react (React, useState, useEffect, useMemo, useCallback, useRef, …)
- recharts (LineChart, AreaChart, BarChart, PieChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Line, Area, Bar, Pie, Cell, …)
- framer-motion (motion, AnimatePresence, useMotionValue, useTransform, …)
- @hugeicons/react (HugeiconsIcon) and @hugeicons/core-free-icons (the icons): import { HugeiconsIcon } from '@hugeicons/react', import { Search01Icon, Add01Icon } from '@hugeicons/core-free-icons', <HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={1.5} />. Names end in Icon; a name the sandbox does not hold draws a help-circle placeholder instead of failing.
- @/ui/button (Button)
- @/ui/card (Card, CardContent, CardHeader, CardTitle)
- @/ui/badge (Badge)
- @/ui/table (Table, TableBody, TableCell, TableHead, TableHeader, TableRow)
- @/ui/tabs (Tabs, TabsContent, TabsList, TabsTrigger)

MOBILE AND RENDERING
The artifact may be shown in a 700px desktop card or full-screen at 340–430px on a phone. Let the layout adapt, keep controls usable at narrow widths, and avoid page-level horizontal scrolling. A wide table may scroll inside its own container. Charts must have a responsive width and a numeric height.

The artifact runs in an isolated iframe with no network access. Do not import packages or load remote scripts/fonts. Use only the modules listed above, and export the component with module.exports = { default: Component }.

The app provides easing variables var(--ease-out) and var(--ease-in-out) if useful. For Recharts, set axis/grid colors deliberately and keep tooltip text readable on its tooltip surface in both themes.

Keep the result specific to the user's request. Favor clear hierarchy and purposeful detail; let the content determine whether it needs a chart, diagram, table, controls, or a more expressive custom layout.`
  })
})

export const createArtifact = (
  chatId: string
): AgentTool<typeof createArtifactSchema> => ({
  name: TOOL_NAMES.createArtifact,
  label: 'Create Artifact',
  description:
    "Create a visual artifact — a chart, a diagram, a comparison, or a small interactive piece — when the content benefits from being seen or explored. It renders as a live React component in an isolated frame. Choose a visual style that suits the request, support light and dark themes, and use the code parameter's design and runtime guidance.",
  parameters: createArtifactSchema,
  execute: async (_toolCallId, { title, code }, signal) => {
    if (signal?.aborted) throw new Error('Aborted')
    const artifactId = uuidV4()

    // Persist artifact to disk (fire-and-forget)
    saveArtifact(chatId, artifactId, title, code).catch(() => {})

    return {
      content: [{ type: 'text' as const, text: `Created artifact: ${title}` }],
      details: {
        type: 'artifact',
        artifactId,
        chatId,
        title,
        code
      }
    }
  }
})
