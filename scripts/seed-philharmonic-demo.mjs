// Seeds Philharmonic demo data (three groups, their teams, employees, plans and
// conversations) into an Actovia data dir. English, around the fictional
// persona the launch screenshots used: Alex, a product designer in San
// Francisco planning a Kyoto trip, training for a half marathon, partner Sam,
// cat Miso.
//
//   node scripts/seed-philharmonic-demo.mjs <database dir>
//
// The app must not be running on that data dir (PGlite is single-process).
// Everything goes in one transaction, and it refuses to run twice (it looks
// for the demo teams by name). No scheduled tasks: a cron or one-off task in a
// real data dir would run agents on the owner's keys.

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'

import { PGlite } from '@electric-sql/pglite'
import { pgmq } from '@electric-sql/pglite-pgmq'
import { vector } from '@electric-sql/pglite-pgvector'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

const dataDir = process.argv[2]
if (!dataDir || !existsSync(`${dataDir}/PG_VERSION`)) {
  console.error('usage: node scripts/seed-philharmonic-demo.mjs <database dir>')
  process.exit(1)
}

const DAY = 86_400_000
const MIN = 60_000
const now = Date.now()
/** `days` ago, at `hour`:`minute` UTC, plus `n` minutes. */
const at = (days, hour, minute = 0, n = 0) => {
  const d = new Date(now - days * DAY)
  d.setUTCHours(hour, minute, 0, 0)
  return new Date(d.getTime() + n * MIN)
}

const TEAMS = [
  {
    key: 'travel',
    name: 'Travel Desk',
    icon: '🧳',
    description: 'Plans trips end to end: places, routes, bookings, budget.',
    systemPrompt:
      'You plan travel for Alex and Sam. Prefer quiet neighbourhoods, walkable days and good coffee. Always give prices in USD and JPY.'
  },
  {
    key: 'training',
    name: 'Training Crew',
    icon: '🏃',
    description: 'Running plans, recovery and the food around them.',
    systemPrompt:
      'You coach Alex towards a sub-2-hour half marathon. Be specific about paces and distances; never push through pain.'
  },
  {
    key: 'studio',
    name: 'Design Studio',
    icon: '🎨',
    description: "Alex's portfolio site: content, code and review.",
    systemPrompt:
      "You work on Alex's portfolio, a Next.js site. Keep it fast, accessible and quiet; the work is the hero."
  }
]

const AGENTS = [
  {
    key: 'mika',
    team: 'travel',
    name: 'Mika',
    seed: 'mika-kyoto',
    style: 'notionists',
    description:
      'Destination researcher — neighbourhoods, temples, seasonal events.',
    systemPrompt:
      'Research places with current opening hours and how busy they get.'
  },
  {
    key: 'theo',
    team: 'travel',
    name: 'Theo',
    seed: 'theo-routes',
    style: 'notionists',
    description:
      'Itinerary planner — turns a list of places into walkable days.',
    systemPrompt: 'Group places by area, keep transfers under 30 minutes.'
  },
  {
    key: 'priya',
    team: 'travel',
    name: 'Priya',
    seed: 'priya-budget',
    style: 'notionists',
    description: 'Budget analyst — stays, rail passes and daily spend.',
    systemPrompt: 'Give totals with a line per item and a 10 % buffer.'
  },
  {
    key: 'jordan',
    team: 'training',
    name: 'Jordan',
    seed: 'jordan-coach',
    style: 'adventurer',
    description: 'Running coach — weekly plans, paces, taper.',
    systemPrompt: 'Plans in kilometres, paces in min/km.'
  },
  {
    key: 'lena',
    team: 'training',
    name: 'Lena',
    seed: 'lena-fuel',
    style: 'adventurer',
    description: 'Sports nutritionist — fuel for long runs and race day.',
    systemPrompt: 'Practical meals Alex can cook in 20 minutes.'
  },
  {
    key: 'iris',
    team: 'studio',
    name: 'Iris',
    seed: 'iris-frontend',
    style: 'thumbs',
    description: 'Frontend engineer — builds pages in the portfolio repo.',
    systemPrompt: 'Small commits, no new dependencies without asking.',
    runtime: 'claude-code',
    model: 'sonnet'
  },
  {
    key: 'oskar',
    team: 'studio',
    name: 'Oskar',
    seed: 'oskar-review',
    style: 'thumbs',
    description: 'Code reviewer — performance, accessibility, polish.',
    systemPrompt: 'Review for Lighthouse, keyboard use and contrast.',
    runtime: 'codex'
  }
]

// Each group: its members, a plan, and the conversation in order. A message
// is [role, agentKey | null, content, minutes after the group's start].
const GROUPS = [
  {
    title: 'Kyoto in April',
    icon: '🌸',
    members: ['mika', 'theo', 'priya'],
    start: at(6, 2, 10),
    plan: {
      summary: 'Five days in Kyoto for Alex and Sam, 14–18 April',
      status: 'completed',
      steps: [
        ['Shortlist places by neighbourhood', 'mika', 'done'],
        ['Lay out five walkable days', 'theo', 'done'],
        ['Price the stay, rail and daily spend', 'priya', 'done']
      ]
    },
    messages: [
      [
        'user',
        null,
        "Sam and I are in Kyoto 14–18 April. We like quiet temples, long walks and good coffee, and we'd rather skip the busiest spots at peak hours. Can you plan the days and tell me roughly what it costs?",
        0
      ],
      [
        'pm',
        null,
        "Got it — five days, quiet over famous, walking first. I've split it three ways: **Mika** shortlists places by neighbourhood, **Theo** turns them into days you can walk, and **Priya** prices the stay, the rail and a daily budget. I'll pull it together when they're done.",
        1
      ],
      [
        'employee',
        'mika',
        "Shortlist, grouped by area:\n\n- **Higashiyama** — Kōdai-ji, the lanes up to Kiyomizu-dera *before 8 am*, Kennin-ji's twin-dragon ceiling.\n- **North** — Shisen-dō and Enkō-ji (moss and maples, rarely crowded), Shimogamo Shrine's forest.\n- **Arashiyama** — the bamboo grove at 7 am, then Ōkōchi Sansō villa; skip the main street after 10.\n- **Fushimi Inari** — go past the Yotsutsuji crossroads; the crowds thin out above it.\n- **Coffee** — Weekenders, % Arabica Higashiyama, Kurasu.\n\nMid-April is the tail of cherry blossom: the Philosopher's Path will still be pretty, and busy after 9.",
        14
      ],
      [
        'employee',
        'theo',
        "Five days, each in one area so you walk rather than ride:\n\n1. **Arrive · Higashiyama** — check in, an evening walk through Gion and Yasaka.\n2. **Early Higashiyama** — Kiyomizu at 7:30, Sannenzaka, Kōdai-ji, lunch near Kennin-ji.\n3. **Arashiyama** — bamboo at 7, Ōkōchi Sansō, Tenryū-ji garden, back by the Hozu river.\n4. **North** — Shisen-dō, Enkō-ji, the Philosopher's Path, Ginkaku-ji late in the day.\n5. **Fushimi Inari + Nishiki** — the upper shrine trail early, then the market for lunch before the train.\n\nNo transfer over 25 minutes; days 2 and 3 start early to stay ahead of the tour groups.",
        27
      ],
      [
        'employee',
        'priya',
        'For two people, five nights:\n\n| Item | USD | JPY |\n|---|---|---|\n| Machiya stay, Higashiyama (5 nights) | 1,150 | 172,000 |\n| Haruka + IC cards | 70 | 10,500 |\n| Local trains & buses | 60 | 9,000 |\n| Entry fees | 55 | 8,200 |\n| Food & coffee (≈ 95 a day) | 475 | 71,000 |\n| **Subtotal** | **1,810** | **270,700** |\n| Buffer 10 % | 180 | 27,000 |\n| **Total** | **≈ 1,990** | **≈ 297,700** |\n\nThe machiya is the big lever: a business hotel near Kyoto Station saves about 450.',
        41
      ],
      [
        'pm',
        null,
        "Here's the trip in one place:\n\n- **Where you stay** — a machiya in Higashiyama, so days 1, 2 and 5 start at the door.\n- **The days** — Theo's plan above; days 2 and 3 start early, which is what keeps the famous places quiet.\n- **What it costs** — about **$1,990** for both of you, buffer included; ≈ $1,540 if you swap the machiya for a hotel by the station.\n\nWant me to have Mika check which temples need a reservation in April?",
        44
      ],
      [
        'user',
        null,
        "This is great. Keep the machiya. And yes — check reservations, and find somewhere Miso's sitter can reach us if they need to.",
        58
      ],
      [
        'pm',
        null,
        "Done: the machiya stays. Mika checked — **Saihō-ji (the moss temple)** needs a postcard or online booking two months ahead, so I've left it out; nothing else on the plan needs one. For Miso's sitter: the machiya has Wi-Fi and a landline — leave them its address and number along with your own, and they can reach you either way.",
        71
      ]
    ]
  },
  {
    title: 'Half marathon — sub 2:00',
    icon: '🏃',
    members: ['jordan', 'lena'],
    start: at(3, 15, 30),
    plan: {
      summary: 'Twelve weeks to a sub-2-hour half marathon on 1 March',
      status: 'active',
      steps: [
        ['Build the 12-week plan', 'jordan', 'done'],
        ['Fuel plan for long runs and race day', 'lena', 'done'],
        ['Adjust week 4 after the calf niggle', 'jordan', 'running']
      ]
    },
    messages: [
      [
        'user',
        null,
        "I'm running the half on 1 March and want to go under 2 hours. Current best is 2:09. I can run four days a week, long run on Sunday.",
        0
      ],
      [
        'pm',
        null,
        'Sub-2:00 means **5:41 /km** — 18 seconds a kilometre faster than your 2:09. Very doable in twelve weeks. **Jordan** will build the plan around four days with a Sunday long run; **Lena** will cover what you eat around the long runs and on race morning.',
        2
      ],
      [
        'employee',
        'jordan',
        '**The shape of the 12 weeks**\n\n- **Tue** — intervals: 6 × 800 m at 5:15 /km building to 8 × 1 km at 5:20.\n- **Thu** — tempo: 5 km at 5:35, growing to 10 km.\n- **Fri** — easy 6–8 km at 6:30 or slower.\n- **Sun** — long run: 12 km in week 1 up to 19 km in week 9, at 6:20.\n\nWeeks 4 and 8 are lighter (recovery); weeks 11–12 taper. Week 10 has a 15 km dress rehearsal with the middle 8 km at race pace.',
        19
      ],
      [
        'employee',
        'lena',
        "**Long runs (over 14 km)** — oats with banana and honey 2 hours before; a gel or 4 dates at 45 minutes and every 30 after; 500 ml water an hour.\n\n**After** — within an hour: rice bowl with eggs or salmon, plus something salty.\n\n**Race morning** — what you've practised, nothing new: the same oats at 5:30 for a 7:30 start, coffee if it's normal for you, one gel 15 minutes before the gun.",
        33
      ],
      [
        'user',
        null,
        'Week 3 done. My left calf has been tight since Sunday — not painful, just tight.',
        2 * 1440 + 120
      ],
      [
        'pm',
        null,
        "Thanks for flagging it early. I've asked **Jordan** to rework week 4 around the calf — it's already a recovery week, so there's room to ease off without losing anything.",
        2 * 1440 + 122
      ]
    ]
  },
  {
    title: 'Portfolio refresh',
    icon: '🖼️',
    members: ['iris', 'oskar'],
    start: at(1, 18, 0),
    plan: {
      summary: 'Case-study pages and a faster home page for the portfolio',
      status: 'active',
      steps: [
        ['Case-study page template', 'iris', 'done'],
        ['Review the template: performance and accessibility', 'oskar', 'done'],
        ['Move the three case studies onto the template', 'iris', 'pending']
      ]
    },
    messages: [
      [
        'user',
        null,
        "The portfolio repo is in ~/Code/portfolio. I'd like proper case-study pages — problem, process, outcome — and the home page is slow on mobile. Start with a template.",
        0
      ],
      [
        'pm',
        null,
        'Plan: **Iris** builds one case-study template in the repo, **Oskar** reviews it for speed and accessibility, then Iris moves the three studies onto it. One step at a time so the review lands before the content moves.',
        1
      ],
      [
        'employee',
        'iris',
        "Template is in `app/work/[slug]/page.tsx`: a hero with the outcome in one line, then **Problem → Process → Outcome** sections from MDX, images through `next/image` with fixed sizes. Committed as `feat(work): case-study template` on the `case-studies` branch. The home page's 1.8 MB hero video now only loads on wide screens.",
        38
      ],
      [
        'employee',
        'oskar',
        "Review of `case-studies`:\n\n- **Performance** — mobile Lighthouse 71 → 94; LCP 3.9 s → 1.6 s once the video is gone on mobile.\n- **Accessibility** — the section headings skipped from h1 to h3: fixed to h2. The gallery's next button had no label. Body text on the grey cards was 3.9:1; darkened to 5.2:1.\n\nAll three fixed in a follow-up commit. Good to move the content.",
        61
      ],
      [
        'pm',
        null,
        'The template is in and reviewed — mobile Lighthouse went from 71 to 94. Next, Iris moves the three case studies across. Shall she start with the banking app redesign?',
        63
      ]
    ]
  }
]

const pg = new PGlite({ dataDir, extensions: { vector, pgmq, pg_trgm } })
await pg.exec(`SET TIME ZONE 'UTC'`)

const existing = await pg.query(`SELECT name FROM team WHERE name = ANY($1)`, [
  TEAMS.map((t) => t.name)
])
if (existing.rows.length > 0) {
  console.error(
    `Already seeded (found team ${existing.rows.map((r) => r.name).join(', ')}); nothing written.`
  )
  await pg.close()
  process.exit(2)
}

const teamIds = Object.fromEntries(TEAMS.map((t) => [t.key, randomUUID()]))
const agentIds = Object.fromEntries(AGENTS.map((a) => [a.key, randomUUID()]))
const created = at(7, 1)

await pg.transaction(async (tx) => {
  for (const t of TEAMS) {
    await tx.query(
      `INSERT INTO team (id, name, description, "systemPrompt", icon, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [teamIds[t.key], t.name, t.description, t.systemPrompt, t.icon, created]
    )
  }
  for (const a of AGENTS) {
    await tx.query(
      `INSERT INTO agent (id, name, description, "teamId", "avatarSeed", "avatarStyle",
         "systemPrompt", runtime, model, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [
        agentIds[a.key],
        a.name,
        a.description,
        teamIds[a.team],
        a.seed,
        a.style,
        a.systemPrompt,
        a.runtime ?? 'actovia',
        a.model ?? null,
        created
      ]
    )
  }

  for (const g of GROUPS) {
    const conversationId = randomUUID()
    const times = g.messages.map(
      ([, , , minutes]) => new Date(g.start.getTime() + minutes * MIN)
    )
    const last = times[times.length - 1]
    await tx.query(
      `INSERT INTO conversation (id, title, icon, "memberAgentIds", "createdAt", "updatedAt", "lastMessageAt")
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [
        conversationId,
        g.title,
        g.icon,
        JSON.stringify(g.members.map((k) => agentIds[k])),
        g.start,
        last
      ]
    )

    for (const [i, [role, agentKey, content]] of g.messages.entries()) {
      await tx.query(
        `INSERT INTO conversation_message (id, "conversationId", role, "agentId", content, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(),
          conversationId,
          role,
          agentKey ? agentIds[agentKey] : null,
          content,
          times[i]
        ]
      )
    }

    const planId = randomUUID()
    const planAt = times[1]
    await tx.query(
      `INSERT INTO conversation_plan (id, "conversationId", summary, status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [planId, conversationId, g.plan.summary, g.plan.status, planAt, last]
    )
    for (const [ordinal, [title, agentKey, status]] of g.plan.steps.entries()) {
      // A done step's times come from the employee message that reported it.
      const reported = g.messages.findIndex(
        ([role, key]) => role === 'employee' && key === agentKey
      )
      const doneAt = reported >= 0 ? times[reported] : last
      await tx.query(
        `INSERT INTO plan_step (id, "planId", ordinal, title, "assignedAgentId", status,
           "startedAt", "completedAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        [
          randomUUID(),
          planId,
          ordinal,
          title,
          agentIds[agentKey],
          status,
          status === 'pending' ? null : planAt,
          status === 'done' ? doneAt : null,
          planAt
        ]
      )
    }
    console.log(
      `✓ ${g.title} — ${g.messages.length} messages, ${g.plan.steps.length} plan steps`
    )
  }
})

console.log(
  `Seeded ${TEAMS.length} teams, ${AGENTS.length} employees, ${GROUPS.length} groups.`
)
await pg.close()
