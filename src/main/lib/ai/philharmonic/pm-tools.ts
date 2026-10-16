// src/main/lib/ai/philharmonic/pm-tools.ts
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

/**
 * `roster` is read again on every call: an employee recruited later in the
 * turn is pushed onto it. An id outside it is refused — the PM model's word
 * alone never starts an employee (a CLI one runs on the owner's machine).
 */
export function createDelegateTaskTool(
  roster: Array<{ id: string; name: string; description: string | null }>,
  onDelegate: (p: {
    employeeId: string
    instructions: string
    stepId?: string
  }) => Promise<string>
): AgentTool {
  const list = roster
    .map(
      (a) => `- ${a.name} (id: ${a.id}): ${a.description ?? 'no description'}`
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
      })
    }),
    execute: async (
      _id: string,
      p: { employeeId: string; instructions: string; stepId?: string }
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
        stepId: p.stepId && p.stepId.length > 0 ? p.stepId : undefined
      })
      return {
        content: [{ type: 'text' as const, text: result }],
        details: { employeeId: p.employeeId, stepId: p.stepId, result }
      }
    }
  } as AgentTool
}

export function createRecruitEmployeeTool(
  onRecruit: (p: { role: string; skills: string[]; name?: string }) => Promise<{
    id: string
    name: string
  }>
): AgentTool {
  return {
    name: 'recruitEmployee',
    label: 'Recruit Employee',
    description:
      'Create a new virtual employee when no current employee fits the work. They join the group immediately.',
    parameters: Type.Object({
      role: Type.String({ description: 'what this employee specializes in' }),
      skills: Type.Array(Type.String(), {
        description: 'skill slugs',
        default: []
      }),
      name: Type.String({
        description: 'optional name; auto-assigned if omitted',
        default: ''
      })
    }),
    execute: async (
      _id: string,
      p: { role: string; skills: string[]; name?: string }
    ) => {
      const emp = await onRecruit({
        role: p.role,
        skills: p.skills ?? [],
        name: p.name || undefined
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: `Recruited ${emp.name} (id: ${emp.id}).`
          }
        ],
        details: emp
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

/** Two minutes after the reset (a past one counts as now); an unknown reset is checked again in an hour. */
export const quotaWaitRunAt = (resetsAt: number | null, now: number) =>
  new Date(
    resetsAt !== null ? Math.max(resetsAt, now) + 2 * 60_000 : now + 60 * 60_000
  )
