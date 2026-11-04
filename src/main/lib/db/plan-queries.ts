import { and, asc, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm'

import { db } from './db'
import {
  conversationPlan,
  planStep,
  type ConversationPlan,
  type PlanStep
} from './schema'

export interface CreatePlanArgs {
  conversationId: string
  summary: string
  steps: Array<{
    title: string
    intent?: string | null
    assignedAgentId?: string | null
  }>
}

/** A plan + its ordered steps. Returned by `getActivePlanByConversationId` and friends. */
export interface PlanWithSteps {
  plan: ConversationPlan
  steps: PlanStep[]
}

/**
 * Create a plan for a conversation along with its initial steps in one
 * transaction. The plan starts in `active` so the renderer doesn't have to
 * filter `drafting` rows.
 */
export async function createPlanWithSteps(
  args: CreatePlanArgs
): Promise<PlanWithSteps> {
  return db.transaction(async (tx) => {
    const [plan] = await tx
      .insert(conversationPlan)
      .values({
        conversationId: args.conversationId,
        summary: args.summary,
        status: 'active'
      })
      .returning()

    if (args.steps.length === 0) return { plan, steps: [] }

    const stepRows = args.steps.map((s, i) => ({
      planId: plan.id,
      ordinal: i,
      title: s.title,
      intent: s.intent ?? null,
      assignedAgentId: s.assignedAgentId ?? null,
      status: 'pending' as const
    }))
    const steps = await tx.insert(planStep).values(stepRows).returning()
    return { plan, steps }
  })
}

export async function appendStepToPlan(
  planId: string,
  step: {
    title: string
    intent?: string | null
    assignedAgentId?: string | null
  }
): Promise<PlanStep> {
  return db.transaction(async (tx) => {
    const [last] = await tx
      .select({ ordinal: planStep.ordinal })
      .from(planStep)
      .where(eq(planStep.planId, planId))
      .orderBy(desc(planStep.ordinal))
      .limit(1)
    const nextOrdinal = (last?.ordinal ?? -1) + 1
    const [row] = await tx
      .insert(planStep)
      .values({
        planId,
        ordinal: nextOrdinal,
        title: step.title,
        intent: step.intent ?? null,
        assignedAgentId: step.assignedAgentId ?? null,
        status: 'pending'
      })
      .returning()
    await tx
      .update(conversationPlan)
      .set({ updatedAt: new Date() })
      .where(eq(conversationPlan.id, planId))
    return row
  })
}

export interface UpdateStepPatch {
  status?: PlanStep['status']
  output?: string | null
  note?: string | null
  taskId?: string | null
  title?: string
  intent?: string | null
  assignedAgentId?: string | null
}

export async function updateStep(
  stepId: string,
  patch: UpdateStepPatch
): Promise<PlanStep> {
  const now = new Date()
  // Status transitions drive started/completed timestamps so the markdown
  // mirror can render elapsed time without an event table.
  const timestampPatch: { startedAt?: Date; completedAt?: Date | null } = {}
  if (patch.status === 'running') timestampPatch.startedAt = now
  if (
    patch.status === 'done' ||
    patch.status === 'failed' ||
    patch.status === 'skipped'
  ) {
    timestampPatch.completedAt = now
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(planStep)
      .set({ ...patch, ...timestampPatch, updatedAt: now })
      .where(eq(planStep.id, stepId))
      .returning()
    await tx
      .update(conversationPlan)
      .set({ updatedAt: now })
      .where(eq(conversationPlan.id, row.planId))
    return row
  })
}

export async function getPlanWithSteps(
  planId: string
): Promise<PlanWithSteps | null> {
  const [plan] = await db
    .select()
    .from(conversationPlan)
    .where(eq(conversationPlan.id, planId))
    .limit(1)
  if (!plan) return null
  const steps = await db
    .select()
    .from(planStep)
    .where(eq(planStep.planId, planId))
    .orderBy(asc(planStep.ordinal))
  return { plan, steps }
}

/** Most recent non-archived plan for a conversation, or null if none. */
export async function getActivePlanByConversationId(
  conversationId: string
): Promise<PlanWithSteps | null> {
  const [plan] = await db
    .select()
    .from(conversationPlan)
    .where(
      and(
        eq(conversationPlan.conversationId, conversationId),
        isNull(conversationPlan.archivedAt)
      )
    )
    .orderBy(desc(conversationPlan.createdAt))
    .limit(1)
  if (!plan) return null
  const steps = await db
    .select()
    .from(planStep)
    .where(eq(planStep.planId, plan.id))
    .orderBy(asc(planStep.ordinal))
  return { plan, steps }
}

/** Active plans and plans updated in the last week for the plan monitor. */
export async function getPlansForDashboard(): Promise<PlanWithSteps[]> {
  const recentSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const plans = await db
    .select()
    .from(conversationPlan)
    .where(
      and(
        isNull(conversationPlan.archivedAt),
        or(
          inArray(conversationPlan.status, ['active', 'drafting']),
          gte(conversationPlan.updatedAt, recentSince)
        )
      )
    )
    .orderBy(desc(conversationPlan.updatedAt))
    .limit(100)
  if (plans.length === 0) return []

  const planIds = plans.map((plan) => plan.id)
  const steps = await db
    .select()
    .from(planStep)
    .where(inArray(planStep.planId, planIds))
    .orderBy(asc(planStep.ordinal))
  const stepsByPlan = new Map<string, PlanStep[]>()
  for (const step of steps) {
    const list = stepsByPlan.get(step.planId) ?? []
    list.push(step)
    stepsByPlan.set(step.planId, list)
  }
  return plans.map((plan) => ({
    plan,
    steps: stepsByPlan.get(plan.id) ?? []
  }))
}

export async function updatePlanStatus(
  planId: string,
  status: ConversationPlan['status']
): Promise<ConversationPlan> {
  const [row] = await db
    .update(conversationPlan)
    .set({ updatedAt: new Date(), status })
    .where(eq(conversationPlan.id, planId))
    .returning()
  return row
}

export async function updatePlanSummary(
  planId: string,
  summary: string
): Promise<void> {
  await db
    .update(conversationPlan)
    .set({ summary, updatedAt: new Date() })
    .where(eq(conversationPlan.id, planId))
}
