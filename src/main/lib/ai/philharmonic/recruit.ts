// src/main/lib/ai/philharmonic/recruit.ts
import {
  DEFAULT_AVATAR_STYLE,
  randomAvatarSeed
} from '@actovia/shared/constants/avatar'

import { createAgent, getAllAgents } from '../../db/philharmonic-queries'
import { getSettings } from '../../db/queries'
import { listInstalledSkills } from '../skills/skills-manager'
import { getModelFromProvider } from '../utils/chat-message-util'
import { completeSimple } from '../utils/complete'
import { pickName } from './names'

const SPEC_PROMPT = `You are designing a virtual employee for a group-chat team. Given a role and optional skills, produce a JSON spec.
Respond with ONLY a JSON object (no markdown):
{"name":"","description":"...","systemPrompt":"..."}
Leave "name" empty — it is assigned separately.`

export interface RecruitParams {
  role: string
  skills?: string[]
  name?: string
  teamId?: string
}

/** Create and persist a new employee. Reused by the PM `recruitEmployee` tool. */
export async function autoCreateEmployee(params: RecruitParams) {
  const setting = await getSettings()
  const { model, apiKey } = getModelFromProvider(setting)

  let description = `Virtual employee for: ${params.role}`
  let systemPrompt = `You are a virtual employee. Your role: ${params.role}.`

  try {
    const result = await completeSimple(
      model,
      {
        systemPrompt: SPEC_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Role: ${params.role}\nSkills: ${(params.skills ?? []).join(', ') || 'none specified'}`
              }
            ],
            timestamp: Date.now()
          }
        ]
      },
      { apiKey }
    )
    const text = result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('')
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      const spec = JSON.parse(match[0]) as {
        description?: string
        systemPrompt?: string
      }
      description = spec.description || description
      systemPrompt = spec.systemPrompt || systemPrompt
    }
  } catch {
    // fall back to defaults
  }

  // The PM names skills freely; only installed slugs are kept. An unknown
  // slug used to be saved as a pick, and a pick list of nothing installed
  // gave the employee no skills at all — where an empty list gives it every
  // active one.
  const installed = new Set((await listInstalledSkills()).map((s) => s.slug))
  const skillSlugs = (params.skills ?? []).filter((s) => installed.has(s))

  const existing = await getAllAgents()
  const name = params.name ?? pickName(existing.map((a) => a.name))

  return createAgent({
    name,
    description,
    systemPrompt,
    teamId: params.teamId ?? null,
    avatarSeed: randomAvatarSeed(),
    avatarStyle: DEFAULT_AVATAR_STYLE,
    skillSlugs,
    mcpServerNames: [],
    toolAllowList: [],
    isActive: true
  })
}
