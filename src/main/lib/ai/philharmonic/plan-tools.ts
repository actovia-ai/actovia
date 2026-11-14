// src/main/lib/ai/philharmonic/plan-tools.ts
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type { PlanStep } from '../../db/schema'

export interface CreatePlanArgs {
  summary: string
  steps: Array<{
    title: string
    intent?: string
    assignedAgentId?: string
  }>
}

export interface UpdateStepArgs {
  stepId: string
  status?: PlanStep['status']
  output?: string
  note?: string
}

export interface AppendStepArgs {
  title: string
  intent?: string
  assignedAgentId?: string
}

export function createCreatePlanTool(
  onCreate: (args: CreatePlanArgs) => Promise<{
    planId: string
    steps: Array<{ id: string; title: string; ordinal: number }>
  }>
): AgentTool {
  return {
    name: 'createPlan',
    label: 'Create Plan',
    description:
      'Lay out the execution plan for this Group before delegating anything. Call this ONCE per user request, even if you only see one step right now. Each step needs a clear title; "intent" explains why; "assignedAgentId" is optional and only when you already know who.',
    parameters: Type.Object({
      summary: Type.String({
        description: 'one-line statement of what the Group is trying to do'
      }),
      steps: Type.Array(
        Type.Object({
          title: Type.String({ description: 'short action statement' }),
          intent: Type.String({
            description: 'why this step exists',
            default: ''
          }),
          assignedAgentId: Type.String({
            description:
              'optional employee id to provisionally assign; leave empty if undecided',
            default: ''
          })
        }),
        { description: 'ordered list of steps', default: [] }
      )
    }),
    execute: async (_id: string, p: CreatePlanArgs) => {
      const created = await onCreate({
        summary: p.summary,
        steps: (p.steps ?? []).map((s) => ({
          title: s.title,
          intent: s.intent && s.intent.length > 0 ? s.intent : undefined,
          assignedAgentId:
            s.assignedAgentId && s.assignedAgentId.length > 0
              ? s.assignedAgentId
              : undefined
        }))
      })
      const lines = created.steps.map(
        (s) => `${s.ordinal + 1}. ${s.title} (stepId: ${s.id})`
      )
      return {
        content: [
          {
            type: 'text' as const,
            text: `Plan saved (planId: ${created.planId}). Use these stepIds when delegating:\n${lines.join('\n')}\n\nNow execute the plan: call updatePlanStep(stepId, status='running'), delegateTask with the stepId, then updatePlanStep with status='done' and the output summary.`
          }
        ],
        details: created
      }
    }
  } as AgentTool
}

export function createUpdatePlanStepTool(
  onUpdate: (args: UpdateStepArgs) => Promise<{ stepId: string }>
): AgentTool {
  return {
    name: 'updatePlanStep',
    label: 'Update Plan Step',
    description:
      'Record progress on a plan step. Call BEFORE a delegation (status="running") and AFTER (status="done" with a one-paragraph output). Use "skipped" when a step is no longer needed and "failed" when the employee could not deliver.',
    parameters: Type.Object({
      stepId: Type.String({ description: 'id from createPlan' }),
      status: Type.String({
        description: 'pending | running | done | skipped | failed',
        default: ''
      }),
      output: Type.String({
        description: 'short summary of what was produced when status=done',
        default: ''
      }),
      note: Type.String({
        description: 'optional commentary visible to the user',
        default: ''
      })
    }),
    execute: async (
      _id: string,
      p: {
        stepId: string
        status?: string
        output?: string
        note?: string
      }
    ) => {
      const status = (p.status || undefined) as PlanStep['status'] | undefined
      const out = await onUpdate({
        stepId: p.stepId,
        status,
        output: p.output && p.output.length > 0 ? p.output : undefined,
        note: p.note && p.note.length > 0 ? p.note : undefined
      })
      return {
        content: [
          { type: 'text' as const, text: `Step ${out.stepId} updated.` }
        ],
        details: out
      }
    }
  } as AgentTool
}

export function createAppendPlanStepTool(
  onAppend: (args: AppendStepArgs) => Promise<{
    stepId: string
    ordinal: number
  }>
): AgentTool {
  return {
    name: 'appendPlanStep',
    label: 'Append Plan Step',
    description:
      'Add a new step to the end of the current plan. Use sparingly — when you discover work the original plan missed. Prefer modeling everything up-front in createPlan.',
    parameters: Type.Object({
      title: Type.String({ description: 'short action statement' }),
      intent: Type.String({
        description: 'why this step exists',
        default: ''
      }),
      assignedAgentId: Type.String({
        description: 'optional employee id',
        default: ''
      })
    }),
    execute: async (
      _id: string,
      p: {
        title: string
        intent?: string
        assignedAgentId?: string
      }
    ) => {
      const out = await onAppend({
        title: p.title,
        intent: p.intent && p.intent.length > 0 ? p.intent : undefined,
        assignedAgentId:
          p.assignedAgentId && p.assignedAgentId.length > 0
            ? p.assignedAgentId
            : undefined
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: `Step appended (stepId: ${out.stepId}, position ${out.ordinal + 1}).`
          }
        ],
        details: out
      }
    }
  } as AgentTool
}
