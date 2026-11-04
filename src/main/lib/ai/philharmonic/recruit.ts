// src/main/lib/ai/philharmonic/recruit.ts
import {
  DEFAULT_AVATAR_STYLE,
  randomAvatarSeed
} from '@actovia/shared/constants/avatar'
import type { ModelSnapshot } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'

import { createAgent, getAllAgents } from '../../db/philharmonic-queries'
import { getSettings } from '../../db/queries'
import type { Settings } from '../../db/schema'
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
  provider?: AiProviders
  model?: string
}

export interface RecruitmentModelOption {
  value: string
  provider: AiProviders
  model: string
  displayName: string
  snapshot: ModelSnapshot
  isDefault: boolean
}

function providerConfigured(setting: Settings, provider: AiProviders): boolean {
  switch (provider) {
    case AiProviders.OpenAiGpt:
      return Boolean(setting.providers?.openaiApiKey)
    case AiProviders.AzureOpenAi:
      return Boolean(
        setting.providers?.azureOpenaiApiKey &&
        setting.providers.azureOpenAiEndpoint
      )
    case AiProviders.AnthropicClaude:
      return Boolean(setting.providers?.anthropicApiKey)
    case AiProviders.GoogleGemini:
      return Boolean(setting.providers?.googleGeminiApiKey)
    case AiProviders.XaiGrok:
      return Boolean(setting.providers?.xAiApiKey)
    case AiProviders.Ollama:
      return Boolean(
        setting.providers?.ollamaBaseUrl ||
        setting.providerConfig?.provider === AiProviders.Ollama
      )
  }
}

function modelScore(snapshot: ModelSnapshot): number {
  const reasoning = snapshot.reasoningLevels.filter(
    (level) => level !== 'off'
  ).length
  return (
    reasoning * 1_000_000_000 +
    (snapshot.maxOutputTokens ?? 0) * 1_000 +
    (snapshot.contextWindow ?? 0)
  )
}

/** A bounded list of configured model choices for the PM's recruit tool. */
export function recruitmentModelOptions(
  setting: Settings
): RecruitmentModelOption[] {
  const currentProvider = setting.providerConfig?.provider as
    | AiProviders
    | undefined
  const options: RecruitmentModelOption[] = []

  for (const provider of Object.values(AiProviders)) {
    if (!providerConfigured(setting, provider)) continue
    const catalog = setting.modelCatalog?.[provider] ?? []
    const current =
      currentProvider === provider && setting.providerConfig?.model
        ? {
            id: setting.providerConfig.model,
            displayName: setting.providerConfig.model,
            snapshot: setting.providerConfig.modelSnapshot ??
              catalog.find(
                (entry) => entry.id === setting.providerConfig?.model
              )?.snapshot ?? {
                contextWindow: null,
                maxOutputTokens: null,
                reasoningLevels: [],
                adaptiveThinking: null,
                budgetThinking: null
              }
          }
        : undefined
    const ranked = catalog.toSorted(
      (a, b) => modelScore(b.snapshot) - modelScore(a.snapshot)
    )
    const selected = new Map(
      [current, ranked[0], ranked.at(-1), ranked[Math.floor(ranked.length / 2)]]
        .filter((entry) => entry !== undefined)
        .map((entry) => [entry.id, entry])
    )

    for (const entry of selected.values()) {
      options.push({
        value: `${provider}::${entry.id}`,
        provider,
        model: entry.id,
        displayName: entry.displayName,
        snapshot: entry.snapshot,
        isDefault:
          currentProvider === provider &&
          setting.providerConfig?.model === entry.id
      })
    }
  }

  return options.slice(0, 24)
}

/** Create and persist a new employee. Reused by the PM `recruitEmployee` tool. */
export async function autoCreateEmployee(params: RecruitParams) {
  const setting = await getSettings()
  const { model, apiKey } = getModelFromProvider(setting)
  const selectedModel =
    params.provider && params.model
      ? recruitmentModelOptions(setting).find(
          (option) =>
            option.provider === params.provider && option.model === params.model
        )
      : undefined
  if ((params.provider || params.model) && !selectedModel) {
    throw new Error('The selected employee model is not configured.')
  }

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
    const match = text.match(/\{[\s\S]*\}/u)
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
    provider: selectedModel?.provider ?? null,
    model: selectedModel?.model ?? null,
    teamId: params.teamId ?? null,
    avatarSeed: randomAvatarSeed(),
    avatarStyle: DEFAULT_AVATAR_STYLE,
    skillSlugs,
    mcpServerNames: [],
    toolAllowList: [],
    isActive: true
  })
}
