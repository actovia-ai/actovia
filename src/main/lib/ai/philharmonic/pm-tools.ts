import type { AiProviders } from '@actovia/shared/types/ai'
// src/main/lib/ai/philharmonic/pm-tools.ts
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { StringEnum, Type } from '@earendil-works/pi-ai'

import type { RecruitmentModelOption } from './recruit'

/**
 * `roster` is read again on every call: an employee recruited later in the
 * turn is pushed onto it. An id outside it is refused — the PM model's word
 * alone never starts an employee (a CLI one runs on the owner's machine).
 */
export function createDelegateTaskTool(
  roster: Array<{
    id: string
    name: string
    description: string | null
    provider?: string | null
    model?: string | null
  }>,
  onDelegate: (p: {
    employeeId: string
    instructions: string
    stepId?: string
    mode?: 'await' | 'background'
  }) => Promise<string>
): AgentTool {
  const list = roster
    .map(
      (a) =>
        `- ${a.name} (id: ${a.id})${a.provider && a.model ? ` [${a.provider} · ${a.model}]` : ''}: ${a.description ?? 'no description'}`
    )
    .join('\n')
  return {
    name: 'delegateTask',
    label: 'Delegate Task',
    description: `Assign a sub-task to one employee and get their result back. Current employees:\n${list || '(none yet — recruit one first)'}\n\nProvide stepId when this delegation fulfills a specific plan step so progress is reflected in the plan card.`,
    parameters: Type.Object({
      employeeId: Type.String({ description: 'id of the employee to assign' }),
      instructions: Type.String({
        description: 'clear, complete instructions'
      }),
      stepId: Type.String({
        description:
          'optional id of the plan step this delegation fulfills; updates step status to running/done',
        default: ''
      }),
      mode: Type.String({
        description:
          '"await" waits here; "background" wakes the PM with the employee report when finished',
        default: 'await'
      })
    }),
    execute: async (
      _id: string,
      p: {
        employeeId: string
        instructions: string
        stepId?: string
        mode?: string
      }
    ) => {
      if (!roster.some((a) => a.id === p.employeeId)) {
        const error = `Unknown employee id ${p.employeeId} — choose one from the list`
        return {
          content: [{ type: 'text' as const, text: error }],
          details: { employeeId: p.employeeId, stepId: p.stepId, error }
        }
      }
      const result = await onDelegate({
        employeeId: p.employeeId,
        instructions: p.instructions,
        stepId: p.stepId && p.stepId.length > 0 ? p.stepId : undefined,
        mode: p.mode === 'background' ? 'background' : 'await'
      })
      return {
        content: [{ type: 'text' as const, text: result }],
        details: { employeeId: p.employeeId, stepId: p.stepId, result }
      }
    }
  } as AgentTool
}

export function createRecruitEmployeeTool(
  modelOptions: RecruitmentModelOption[],
  onRecruit: (p: {
    role: string
    skills: string[]
    name?: string
    provider?: AiProviders
    model?: string
  }) => Promise<{
    id: string
    name: string
    provider?: string | null
    model?: string | null
  }>
): AgentTool {
  const modelDescription =
    modelOptions.length > 0
      ? `Select exactly one configured provider::model value. Match task complexity to the model: use a capable reasoning model for difficult or open-ended work and an ordinary model for routine work.\n${modelOptions
          .map((option) => {
            const reasoning = option.snapshot.reasoningLevels.filter(
              (level) => level !== 'off'
            )
            const capability = [
              reasoning.length > 0
                ? `reasoning ${reasoning.join('/')}`
                : 'no listed reasoning modes',
              option.snapshot.maxOutputTokens
                ? `${option.snapshot.maxOutputTokens} max output tokens`
                : null,
              option.isDefault ? 'current default' : null
            ]
              .filter(Boolean)
              .join(', ')
            return `- ${option.value} (${option.displayName}; ${capability})`
          })
          .join('\n')}`
      : 'No configured model catalog is available; leave this empty to use the app default.'
  return {
    name: 'recruitEmployee',
    label: 'Recruit Employee',
    description: `Create a new virtual employee when no current employee fits the work. They join the group immediately. Choose the employee model for this role and task.\n${modelDescription}`,
    parameters: Type.Object({
      role: Type.String({ description: 'what this employee specializes in' }),
      skills: Type.Array(Type.String(), {
        description: 'skill slugs',
        default: []
      }),
      name: Type.String({
        description: 'optional name; auto-assigned if omitted',
        default: ''
      }),
      model:
        modelOptions.length > 0
          ? StringEnum(
              modelOptions.map((option) => option.value) as [
                string,
                ...string[]
              ],
              { description: 'configured provider::model choice' }
            )
          : Type.String({
              description: 'configured provider::model choice',
              default: ''
            })
    }),
    execute: async (
      _id: string,
      p: { role: string; skills: string[]; name?: string; model?: string }
    ) => {
      const selectedModel = modelOptions.find(
        (option) => option.value === p.model
      )
      if (modelOptions.length > 0 && !selectedModel) {
        throw new Error('Choose an employee model from the configured list.')
      }
      const emp = await onRecruit({
        role: p.role,
        skills: p.skills ?? [],
        name: p.name || undefined,
        provider: selectedModel?.provider,
        model: selectedModel?.model
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: `Recruited ${emp.name} (id: ${emp.id})${emp.provider && emp.model ? ` with ${emp.provider} · ${emp.model}` : ' on the app default model'}.`
          }
        ],
        details: {
          ...emp,
          provider: emp.provider ?? null,
          model: emp.model ?? null
        }
      }
    }
  } as AgentTool
}

/** Park a step until the quota that blocks its employee resets (spec 2026-10-16 §5). */
export function createWaitForQuotaTool(
  onWait: (p: {
    stepId: string
    employeeId: string
    reason: string
  }) => Promise<string>
): AgentTool {
  return {
    name: 'waitForQuota',
    label: 'Wait for Quota',
    description:
      'The step needs an employee whose quota is used up and no other employee can do it well: leave the step pending and get woken when the quota resets. Then end your turn with one line saying what you are waiting for. Do not use it while the employee can still run, or when another employee could do the step.',
    parameters: Type.Object({
      stepId: Type.String({ description: 'the plan step that waits' }),
      employeeId: Type.String({
        description: 'the employee the step waits for'
      }),
      reason: Type.String({
        description:
          'one line for the owner: what waits for what, and why not someone else'
      })
    }),
    execute: async (
      _id: string,
      p: { stepId: string; employeeId: string; reason: string }
    ) => {
      const result = await onWait(p)
      return {
        content: [{ type: 'text' as const, text: result }],
        details: { ...p, result }
      }
    }
  } as AgentTool
}

export function createWatchForTool(
  onWatch: (p: {
    stepId: string
    path: string
    intervalSec: number
    deadline: string
    reason: string
  }) => Promise<string>
): AgentTool {
  return {
    name: 'watchFor',
    label: 'Watch for Completion',
    description:
      'Wait for a completion marker file written inside this Group workspace. The path must be relative; check at least every 60 seconds and set a deadline.',
    parameters: Type.Object({
      stepId: Type.String({ description: 'plan step to park' }),
      path: Type.String({ description: 'relative completion-marker path' }),
      intervalSec: Type.Number({
        description: 'seconds between checks (minimum 60)',
        default: 60
      }),
      deadline: Type.String({
        description: 'ISO-8601 deadline, at most 24 hours away'
      }),
      reason: Type.String({
        description: 'what is running and what the marker means'
      })
    }),
    execute: async (
      _id: string,
      p: {
        stepId: string
        path: string
        intervalSec: number
        deadline: string
        reason: string
      }
    ) => ({
      content: [{ type: 'text' as const, text: await onWatch(p) }],
      details: p
    })
  } as AgentTool
}

/** Two minutes after the reset (a past one counts as now); an unknown reset is checked again in an hour. */
export const quotaWaitRunAt = (resetsAt: number | null, now: number) =>
  new Date(
    resetsAt === null ? now + 60 * 60_000 : Math.max(resetsAt, now) + 2 * 60_000
  )
