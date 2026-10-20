// src/main/lib/ai/philharmonic/plan-dto.ts
import type { PlanDto, StepDto } from '@actovia/shared/types/philharmonic'

import type { ConversationPlan, PlanStep } from '../../db/schema'

export function toStepDto(row: PlanStep): StepDto {
  return {
    id: row.id,
    planId: row.planId,
    ordinal: row.ordinal,
    title: row.title,
    intent: row.intent,
    assignedAgentId: row.assignedAgentId,
    status: row.status,
    output: row.output,
    note: row.note,
    taskId: row.taskId,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null
  }
}

export function toPlanDto(plan: ConversationPlan, steps: PlanStep[]): PlanDto {
  return {
    id: plan.id,
    conversationId: plan.conversationId,
    summary: plan.summary,
    status: plan.status,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    steps: steps.map(toStepDto)
  }
}
