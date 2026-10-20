import {
  DEFAULT_AVATAR_STYLE,
  randomAvatarSeed
} from '@actovia/shared/constants/avatar'

import { createAgent, getAllAgents } from '../../db/philharmonic-queries'
import { getSettings } from '../../db/queries'
import { getModelFromProvider } from '../utils/chat-message-util'
// src/main/lib/ai/philharmonic/recruit.ts
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

  const existing = await getAllAgents()
  const name = params.name ?? pickName(existing.map((a) => a.name))

  return createAgent({
    name,
    description,
    systemPrompt,
    teamId: params.teamId ?? null,
    avatarSeed: randomAvatarSeed(),
    avatarStyle: DEFAULT_AVATAR_STYLE,
    skillSlugs: params.skills ?? [],
    mcpServerNames: [],
    toolAllowList: [],
    isActive: true
  })
}
