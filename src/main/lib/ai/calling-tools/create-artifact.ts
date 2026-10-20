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
    description: `A self-contained React component in TSX using CommonJS require(). The component renders inside a browser-chrome-wrapped card in a live chat. Treat every artifact as a small, distinctive design piece — not a default dashboard.

CRITICAL — THEME ADAPTATION (read this first, ignoring it ships a broken artifact):
The sandbox toggles a \`.dark\` class on <html>. Hard-coded hex/rgb/oklch values are baked in and DO NOT flip with the theme — an artifact authored in light mode will be unreadable in dark mode and vice versa. Static Tailwind palette classes (\`bg-stone-*\`, \`text-stone-*\`, \`border-stone-*\`, \`bg-gray-*\`, \`text-zinc-*\`, etc.) have the same problem.

The ONLY way to ship a theme-correct artifact is to use these tokens for every surface, every piece of text, and every border:
- Surfaces: \`bg-background\`, \`bg-card\`, \`bg-muted\`, \`bg-popover\` (or \`var(--background)\`, \`var(--card)\`, \`var(--muted)\`, \`var(--popover)\`)
- Text: \`text-foreground\`, \`text-muted-foreground\`, \`text-card-foreground\` (or \`var(--foreground)\`, \`var(--muted-foreground)\`)
- Borders / dividers: \`border-border\`, plain \`border\` (or \`var(--border)\`)
- UI accents: \`text-primary\`, \`bg-primary/10\`, \`bg-secondary\`, \`bg-accent\`, \`bg-destructive\`/\`text-destructive-foreground\`
- Charts ONLY: \`var(--chart-1)\` … \`var(--chart-5)\` — these already adapt per theme.

WRONG (every line below breaks in the opposite theme):
  style={{ background: '#f7f5f1', color: '#1f2937' }}
  style={{ background: '#fcfbf8' }}                            // covers Card's bg-card
  className="bg-stone-50 text-stone-900 border-stone-200"
  <Card style={{ background: '#fff' }}>
  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">  // no dark: variant

RIGHT:
  className="bg-background text-foreground"
  <Card className="bg-card border-border">                     // shadcn already themes Card
  className="text-muted-foreground border-border"
  className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900"  // status colors paired
  style={{ color: 'var(--muted-foreground)' }}                 // inline only when Tailwind can't reach (e.g. recharts axis stroke)

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

MEDIA:
- You may use externally hosted image/video URLs returned by web_search media results directly in <img>, <video>, or as links to source pages.
- Prefer Brave thumbnail URLs for image display when available; link back to the original sourceUrl for attribution/inspection.
- Never invent media URLs. If web_search did not return media, make a strong visual artifact with icons, diagrams, tables, and layout instead of fake images.
- Always include meaningful alt text for images. For videos, show the thumbnail and open the sourceUrl in a new tab unless you are sure the URL is directly embeddable.

STYLING:
- Tailwind utility classes. For dimensions, prefer inline style={{}} over arbitrary values like h-[380px] — arbitrary values are NOT available in the sandbox CSS.
- For colors, follow the THEME ADAPTATION rules above — every surface/text/border goes through theme tokens. \`primary\` is the user's chosen colour tone (it may be emerald, blue, violet, rose, orange, yellow or plain neutral) — the one accent an artifact needs, and it already matches the app around it.
- The app's easing tokens are in scope: \`var(--ease-out)\` = cubic-bezier(0.23, 1, 0.32, 1) for anything entering or leaving, \`var(--ease-in-out)\` = cubic-bezier(0.77, 0, 0.175, 1) for something moving on screen. In framer-motion write them as \`ease: [0.23, 1, 0.32, 1]\` / \`[0.77, 0, 0.175, 1]\`.
- Recharts: wrap every chart in \`<ResponsiveContainer width="100%" height={220}>\` — the width follows the screen, the height is always a number. Never a fixed pixel width on the chart, never a percentage height. Wire \`stroke\` / \`fill\` to \`var(--chart-1..5)\`, axes to \`var(--muted-foreground)\`, gridlines to \`var(--border)\`.
- Export default a React component via module.exports.

PHONE AND DESKTOP (every artifact is seen in both):
The same component renders in a ~720px card on the desktop and full screen on a phone, 340–430px wide. It must read well at 340px without zooming or sideways scrolling of the page:
- No fixed widths over 300px on anything; let blocks take the width they are given. Charts follow the rule above.
- Side by side only when there is room: lay out columns with inline \`style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}\` (or \`flexWrap: 'wrap'\`), which stacks them on a phone. Do not use \`sm:\` / \`md:\` / \`lg:\` prefixes — the sandbox CSS does not guarantee them.
- A table with more than three columns sits in \`<div style={{ overflowX: 'auto' }}>\` so only the table scrolls; keep its first column short.
- A header row of title + numbers wraps (\`flexWrap: 'wrap'\`) rather than squeezing; tab and segment labels stay one or two words.
- Tap targets at least 40px tall; nothing that only appears on hover — a tooltip may enrich, never carry, the information.

CRAFT (this is what makes an artifact feel designed rather than generated — apply all of it, every time):

Typography
- Inherit the app's font; never set font-family except \`ui-monospace, Menlo, monospace\` for code, paths and identifiers — never as shorthand for "technical".
- At most three sizes, at least 1.25× apart, weights 400 / 500 / 600. One heading. Labels 11–12px in \`text-muted-foreground\`; uppercase with letter-spacing only for a section label, never for body or values.
- Numbers get \`tabular-nums\`; a large numeral gets \`tracking-tight\` and a light or medium weight, its unit smaller and muted beside it.
- Left-align. Sentence case. Real words, no lorem ipsum, no exclamation marks, no emoji anywhere (Hugeicons, size 16, strokeWidth 1.5–1.75, are the only pictures).

Surface and space
- One \`Card\` is a surface; rows inside it are separated by hairlines (\`divide-y\`, \`border-border\`), not by boxes inside boxes. Two levels of surface at most.
- \`rounded-lg\` on cards and panels, \`rounded-md\` inside them; 1px borders; \`shadow-xs\` at most — depth comes from the hairline and the muted surface, not from shadows.
- An 8px rhythm (8 / 12 / 16 / 24 / 32) with contrast: tight within a group, generous between groups. Padding 20–24 on a card, 12–16 on a row.
- Fill the card's width; do not centre a narrow column. Asymmetry reads as designed, centring reads as a template.

Colour
- The neutrals are the tokens. One accent, \`primary\` (\`text-primary\`, \`bg-primary\`, \`bg-primary/10\`, \`stroke="var(--primary)"\`), used rarely — a selected row, the one line that matters, a filled control. Status hues (emerald / amber / rose) only for status, and always paired with their \`dark:\` variants.
- Never pure black or white: every surface and every text colour is a token.

Motion — decide in this order, and default to none
1. How often will the user see it? A thing toggled many times a session (a tab, a filter, a hover) gets 150ms on colour and opacity or nothing; an entrance happens once; a chart's line may draw in once because the shape is the explanation. Nothing loops: no \`repeat: Infinity\`, no floating, pulsing, shimmering or orbiting decoration.
2. What is it for? Feedback (a press), state (open/closed, selected), space (where a thing came from), or explanation. If the answer is "it looks nice", do not animate it.
3. Easing: \`[0.23, 1, 0.32, 1]\` for anything entering or leaving, \`[0.77, 0, 0.175, 1]\` for movement on screen, \`linear\` only for constant motion. Never ease-in, never bounce or elastic; a spring is \`{ type: 'spring', duration: 0.3, bounce: 0.1 }\` at most and only for something the hand drags.
4. Duration: press 100–160ms, hover 150ms, an entrance or reveal 200–300ms, a page-sized opening 250ms. Nothing in an artifact takes longer than 300ms.
5. Only \`opacity\` and \`transform\`. An entrance is \`initial={{ opacity: 0, y: 6 }}\` — six pixels, never a slide from far away, never \`scale: 0\` (start at 0.97 if you scale). Do not animate width, height, padding or colour of a surface; the one exception is a section growing in place, done with \`grid-template-rows\` 0fr → 1fr over 250ms so the content below moves with it instead of jumping.
6. Stagger at most 40ms per item and at most six items; after that, everything arrives together.
7. Every pressable thing answers the press: \`whileTap={{ scale: 0.97 }}\` (or \`active:scale-[0.97]\`) with a 150ms ease-out transition, a visible hover, and a \`focus-visible\` ring. Never \`transition-all\`; name the properties.
8. Respect \`useReducedMotion()\` from framer-motion: when it is true, drop the movement and keep only the opacity change.

Interaction
- Tabs and segmented controls swap in 150ms with the selected item on \`bg-card\` + \`shadow-xs\` (or \`bg-muted\`), the rest in \`text-muted-foreground\`; the panel content itself does not animate on a switch.
- A disclosure opens in place (see Motion 5) with a chevron that rotates 180° in 200ms; the toggle stays where it was.
- Anything that can be hovered for a value (a chart point, a row) shows it immediately — a readout follows the pointer, it is never animated.

Data
- Legible before decorated: a title that says what the numbers are, units on the axis or in the label, the source or period if there is one.
- Lines 1.5–2px, \`type="monotone"\`, \`dot={false}\`; at most a faint wash under one line (a gradient from the line's colour at 14–18% opacity to 0); gridlines dashed \`var(--border)\`, horizontal only; ticks 11px \`var(--muted-foreground)\`, \`tickLine={false}\`, \`axisLine={false}\`.
- One series in \`var(--primary)\`; several in \`var(--chart-1..5)\`. Never a rainbow, never 3D, never a pie for more than four slices.
- Tables: hairline rows, numbers right-aligned in \`tabular-nums\`, the header in the label style.

STRICT BANS (these are AI tells — NEVER produce them):
- Hard-coded hex / rgb / oklch on \`background\`, \`color\`, or \`border-color\` for any surface, text, or divider. (Recharts \`stroke\`/\`fill\` and decorative SVG inside an icon are the ONLY exceptions, and even there prefer \`var(--chart-*)\` / \`var(--primary)\`.)
- Static Tailwind palette classes for surfaces or text (\`bg-stone-*\`, \`text-stone-*\`, \`border-stone-*\`, \`bg-gray-*\`, \`text-gray-*\`, \`bg-zinc-*\`, \`text-zinc-*\`, \`bg-neutral-*\`, \`text-neutral-*\`, \`bg-slate-*\`, \`text-slate-*\`). Status badges (emerald/amber/rose/red) are OK only when paired with their \`dark:\` counterparts.
- Inline \`style={{ background: ... }}\` on \`<Card>\` or any surface container — Card already themes itself, override only by changing className to a different theme token.
- Gradients on surfaces or text (hero gradients, gradient borders, background-clip: text), glassmorphism / backdrop blur, drop shadows, glows.
- Emoji as icons or decoration; particles, confetti, floating or bouncing elements, \`repeat: Infinity\`, shimmer/skeleton loaders in a finished artifact.
- \`ease-in\`, bounce / elastic easing, anything over 300ms, \`transition-all\`, animating width / height / padding (except the grid-rows disclosure), entrances from \`scale: 0\` or from off-screen.
- Side-stripe borders greater than 1px on cards/list items/callouts (border-left: 3px solid … and variants); \`rounded-3xl\` / pill-shaped cards; borders thicker than 1px.
- Identical card grids of icon + heading + text repeated endlessly; the hero-metric template (giant number, tiny label, gradient accent); centred single columns; uppercase body text.
- Cyan-on-dark or purple-to-blue gradients; monospace as shorthand for "technical".

EXAMPLE (good — theme-token surfaces, one accent on the tone, hairlines, tabular numbers, one 250ms entrance, a line that draws in once, a segmented control that answers the press, reduced motion respected):
const React = require('react')
const { useState } = React
const { motion, useReducedMotion } = require('framer-motion')
const { Card, CardContent } = require('@/ui/card')
const { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } = require('recharts')

const SERIES = {
  ytd: [
    { d: 'Jan', a: 100, b: 100 }, { d: 'Feb', a: 108, b: 103 }, { d: 'Mar', a: 112, b: 107 },
    { d: 'Apr', a: 119, b: 109 }, { d: 'May', a: 124, b: 118 }, { d: 'Jun', a: 132, b: 124 }
  ],
  q2: [
    { d: 'Apr', a: 100, b: 100 }, { d: 'May', a: 104, b: 108 }, { d: 'Jun', a: 111, b: 113 }
  ]
}
const RANGES = [{ id: 'ytd', label: 'Year to date' }, { id: 'q2', label: 'Q2' }]
const EASE = [0.23, 1, 0.32, 1]

function Performance() {
  const [range, setRange] = useState('ytd')
  const reduced = useReducedMotion()
  const data = SERIES[range]
  const last = data[data.length - 1]
  return (
    <motion.div
      initial={{ opacity: 0, y: reduced ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE }}
      className="bg-background text-foreground"
      style={{ padding: 24 }}
    >
      <Card className="bg-card border-border rounded-lg shadow-xs">
        <CardContent className="divide-y divide-border" style={{ padding: 0 }}>
          <div style={{ padding: '20px 24px 16px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <div className="text-muted-foreground" style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Indexed performance · base 100
              </div>
              <div className="text-foreground" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', marginTop: 4 }}>
                Corning vs Furukawa
              </div>
            </div>
            <div className="text-foreground tabular-nums" style={{ display: 'flex', gap: 20, fontSize: 13 }}>
              <span>GLW <span className="text-primary" style={{ fontWeight: 500 }}>{last.a}</span></span>
              <span>5801.T <span className="text-muted-foreground" style={{ fontWeight: 500 }}>{last.b}</span></span>
            </div>
          </div>

          <div style={{ padding: '16px 16px 8px' }}>
            <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="d" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} domain={['dataMin - 4', 'dataMax + 4']} />
              <Tooltip cursor={{ stroke: 'var(--border)' }} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
              <Line key={range + '-a'} type="monotone" dataKey="a" stroke="var(--primary)"  dot={false} isAnimationActive={!reduced} animationDuration={300} animationEasing="ease-out" />
              <Line key={range + '-b'} type="monotone" dataKey="b" stroke="var(--muted-foreground)" strokeWidth={1.5} dot={false} isAnimationActive={!reduced} animationDuration={300} animationEasing="ease-out" />
            </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-muted/40" style={{ display: 'flex', gap: 4, padding: 4 }}>
            {RANGES.map((r) => (
              <motion.button
                key={r.id}
                type="button"
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.15, ease: EASE }}
                onClick={() => setRange(r.id)}
                className={range === r.id ? 'bg-card text-foreground shadow-xs rounded-md' : 'text-muted-foreground rounded-md'}
                style={{ flex: 1, padding: '6px 10px', fontSize: 13, transition: 'color 150ms var(--ease-out), background-color 150ms var(--ease-out)' }}
              >
                {r.label}
              </motion.button>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

module.exports = { default: Performance }`
  })
})

export const createArtifact = (
  chatId: string
): AgentTool<typeof createArtifactSchema> => ({
  name: TOOL_NAMES.createArtifact,
  label: 'Create Artifact',
  description:
    "Create a visual artifact — a chart, a table, a comparison, a small interactive piece — rendered as a live React component inside the chat, in the app's own design system (its theme tokens, the user's colour tone, its easing). Use it when something is better seen than read: after collecting data, comparing options, analysing numbers, or when the user asks for a page or a demo. The code parameter's description is the design contract; follow it.",
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
