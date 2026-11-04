// src/main/lib/ai/philharmonic/report-tools.ts
//
// PM-side tool that produces a final-report Artifact rendered live in the
// Group chat. Reuses the same on-disk format and sandbox as Chat's
// createArtifact — see src/main/lib/ai/artifacts.ts and
// src/main/lib/ai/calling-tools/create-artifact.ts. The only delta is we
// stash the result via onCreate so the PM coordinator can attach it to the
// turn's final conversation_message row.

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import { v4 as uuidV4 } from 'uuid'

import { saveArtifact } from '../artifacts'

const createReportSchema = Type.Object({
  title: Type.String({
    description: 'Short title for the report (shown in the card header)'
  }),
  code: Type.String({
    description: `A self-contained React component in TSX using CommonJS require(), exported as module.exports = { default: Component }. Renders inside a sandboxed browser-chrome card in the Group chat as the team's deliverable for this turn.

USE FOR THE FINAL OUTPUT. Call createReport only at the END of a turn, after the work is done, when rendering will help the user actually consume the result (charts, dashboards, comparison tables, structured summaries). Do NOT use it to show intermediate progress or raw quotes — those belong in plain text. Calling it multiple times in one turn produces multiple artifacts.

CRITICAL — THEME TOKENS (read first, or your artifact will be unreadable in one theme):
The sandbox toggles a .dark class on <html>. Hard-coded hex/rgb/oklch values DO NOT flip. Use these tokens for every surface, every piece of text, and every border:
- Surfaces: bg-background, bg-card, bg-muted, bg-popover (or var(--background), var(--card), var(--muted))
- Text: text-foreground, text-muted-foreground, text-card-foreground (or var(--foreground), var(--muted-foreground))
- Borders: border-border (or var(--border))
- Accents: text-primary, bg-primary/10, bg-secondary, bg-accent, bg-destructive
- Charts: var(--chart-1) … var(--chart-5)

AVAILABLE IMPORTS:
- react (React, useState, useEffect, useMemo, useCallback, useRef, …)
- recharts (LineChart, AreaChart, BarChart, PieChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Line, Area, Bar, Pie, Cell, …)
- framer-motion (motion, AnimatePresence, useMotionValue, useTransform, …)
- @hugeicons/react (HugeiconsIcon) and @hugeicons/core-free-icons (the icons): \`import { HugeiconsIcon } from '@hugeicons/react'\`, \`import { Search01Icon, Add01Icon } from '@hugeicons/core-free-icons'\`, \`<HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={1.5} />\`. Names end in \`Icon\`, most with a two-digit variant: Search01Icon, Add01Icon, Tick02Icon, Cancel01Icon, ArrowRight01Icon, ArrowDown01Icon, ArrowUpIcon, Calendar03Icon, Clock01Icon, Settings01Icon, UserIcon, UserGroupIcon, Globe02Icon, Download01Icon, Copy01Icon, Delete02Icon, EditIcon, AlertCircleIcon, Alert02Icon, CheckmarkCircle02Icon, InformationCircleIcon, HelpCircleIcon, Loading03Icon, RefreshIcon, FilterIcon, ChartHistogramIcon, ChartUpIcon, ChartDownIcon, PieChartIcon, MoneyBag02Icon, Wallet01Icon, File01Icon, Folder01Icon, Image01Icon, LinkIcon, StarIcon, ZapIcon, SparklesIcon, Location01Icon, HomeIcon, Mail01Icon, Message01Icon, Notification03Icon, SidebarLeftIcon. A name the sandbox does not hold draws a help-circle placeholder instead of failing.
- @/ui/button (Button)
- @/ui/card (Card, CardContent, CardHeader, CardTitle)
- @/ui/badge (Badge)
- @/ui/table (Table, TableBody, TableCell, TableHead, TableHeader, TableRow)
- @/ui/tabs (Tabs, TabsContent, TabsList, TabsTrigger)

STYLING:
- Tailwind utility classes. For dimensions, prefer inline style={{}} over arbitrary values like h-[380px] — arbitrary values are NOT available in the sandbox CSS.
- For colors, follow the THEME TOKENS rules above.
- Recharts: pass width and height as numbers directly on the chart component. Wire stroke / fill to var(--chart-1..5), axes to var(--muted-foreground), gridlines to var(--border).
- Export default a React component via module.exports.

STRICT BANS:
- Hard-coded hex / rgb / oklch on background, color, or border-color for any surface, text, or divider.
- Static Tailwind palette classes for surfaces or text (bg-stone-*, text-stone-*, bg-gray-*, etc.). Status badges (emerald/amber/rose/red) are OK only when paired with their dark: counterparts.
- Inline style={{ background: ... }} on <Card> — Card already themes itself.
- Gradient text. Glassmorphism / blur. Side-stripe borders > 1px. Hero-metric template with giant number + tiny label + gradient accent.
- Identical card grids of icon + heading + text repeated endlessly.

EXAMPLE structure:
const React = require('react')
const { Card, CardContent } = require('@/ui/card')

function Report() {
  return (
    <Card className="bg-card border-border">
      <CardContent style={{ padding: 24 }}>
        <div className="text-muted-foreground" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Section
        </div>
        <div className="text-foreground" style={{ fontSize: 22, fontWeight: 600 }}>
          Headline
        </div>
      </CardContent>
    </Card>
  )
}

module.exports = { default: Report }
`
  })
})

export interface PendingArtifact {
  artifactId: string
  title: string
  code: string
}

export function createReportTool(
  conversationId: string,
  onCreate: (artifact: PendingArtifact) => void
): AgentTool {
  return {
    name: 'createReport',
    label: 'Create Report',
    description:
      'Render the final deliverable as an interactive Artifact card in the Group chat. Use ONLY at the end of a turn for the final output — charts, dashboards, comparison tables, or structured summaries that benefit from visual rendering.',
    parameters: createReportSchema,
    execute: async (
      _toolCallId: string,
      { title, code }: { title: string; code: string }
    ) => {
      const artifactId = uuidV4()
      // Persist before publishing the card so a failed save cannot look like a
      // completed deliverable that is missing from Artifacts.
      await saveArtifact(conversationId, artifactId, title, code)
      onCreate({ artifactId, title, code })
      return {
        content: [{ type: 'text' as const, text: `Created report: ${title}` }],
        details: {
          type: 'artifact',
          artifactId,
          chatId: conversationId,
          title,
          code
        }
      }
    }
  } as AgentTool
}
