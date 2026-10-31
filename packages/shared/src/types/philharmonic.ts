import type { AgentCard } from './agents'

export enum TaskStatus {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
  WaitingForUser = 'waiting_for_user'
}

export enum TaskPriority {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Urgent = 'urgent'
}

export enum ExecutionStatus {
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed'
}

export const CONVERSATION_MESSAGE_ROLES = [
  'user',
  'pm',
  'employee',
  'system'
] as const
export type ConversationMessageRole =
  (typeof CONVERSATION_MESSAGE_ROLES)[number]

export type PhilharmonicSseEvent =
  | { type: 'task_status'; taskId: string; status: TaskStatus }
  | { type: 'agent_start'; taskId: string; agentId: string; agentName: string }
  | {
      type: 'message_update'
      taskId: string
      agentId: string
      content: string
    }
  | {
      type: 'tool_start'
      taskId: string
      agentId: string
      toolName: string
    }
  | {
      type: 'tool_end'
      taskId: string
      agentId: string
      toolName: string
      result: unknown
    }
  | {
      type: 'delegation_start'
      taskId: string
      childTaskId: string
      childAgentId: string
    }
  | { type: 'delegation_end'; childTaskId: string; result: unknown }
  | {
      type: 'escalation'
      taskId: string
      question: string
      options: string[]
    }
  | { type: 'task_completed'; taskId: string; output: unknown }
  | { type: 'task_failed'; taskId: string; error: string }
  | { type: 'cron_fired'; scheduleTaskId: string; childTaskId: string }
  | {
      type: 'agent_created'
      taskId: string
      agentId: string
      agentName: string
    }
  | {
      type: 'shadow_agent_created'
      taskId: string
      shadowAgentId: string
      originalAgentId: string
    }
  | {
      type: 'task_queued'
      taskId: string
      reason: 'agent_busy' | 'cron_no_shadow'
    }
  | {
      type: 'message_start'
      conversationId: string
      messageId: string
      role: ConversationMessageRole
      agentId?: string
    }
  | {
      type: 'message_delta'
      conversationId: string
      messageId: string
      delta: string
    }
  | {
      type: 'message_end'
      conversationId: string
      messageId: string
    }
  | {
      type: 'tool_card'
      conversationId: string
      messageId: string
      toolName: string
      phase: 'start' | 'end'
      result?: unknown
    }
  | {
      type: 'agent_card'
      conversationId: string
      messageId: string
      card: AgentCard
    }
  | { type: 'member_joined'; conversationId: string; agentId: string }
  | { type: 'round_start'; conversationId: string; label: string }
  | {
      type: 'ask_user'
      conversationId: string
      questionId?: string
      question: string
      options: string[]
    }
  | { type: 'conversation_error'; conversationId: string; error: string }
  | { type: 'pm_started'; conversationId: string }
  | {
      type: 'pm_ended'
      conversationId: string
      reason: 'done' | 'error' | 'aborted'
    }
  | {
      type: 'delegation_retry'
      conversationId: string
      taskId: string
      agentId: string
      attempt: number
      delayMs: number
      error: string
    }
  | { type: 'plan_created'; conversationId: string; plan: PlanDto }
  | {
      type: 'plan_step_updated'
      conversationId: string
      stepId: string
      patch: StepPatch
    }
  | { type: 'plan_step_appended'; conversationId: string; step: StepDto }
  | { type: 'plan_status_changed'; conversationId: string; status: PlanStatus }

export const PLAN_STATUSES = [
  'drafting',
  'active',
  'completed',
  'aborted'
] as const
export type PlanStatus = (typeof PLAN_STATUSES)[number]

export const STEP_STATUSES = [
  'pending',
  'running',
  'done',
  'skipped',
  'failed'
] as const
export type StepStatus = (typeof STEP_STATUSES)[number]

export interface StepDto {
  id: string
  planId: string
  ordinal: number
  title: string
  intent: string | null
  assignedAgentId: string | null
  status: StepStatus
  output: string | null
  note: string | null
  taskId: string | null
  startedAt: string | null
  completedAt: string | null
}

export interface StepPatch {
  status?: StepStatus
  output?: string | null
  note?: string | null
  startedAt?: string | null
  completedAt?: string | null
  assignedAgentId?: string | null
  title?: string
  intent?: string | null
}

export interface PlanDto {
  id: string
  conversationId: string
  summary: string
  status: PlanStatus
  createdAt: string
  updatedAt: string
  steps: StepDto[]
}

export interface AutoRouteResult {
  departmentId: string
  agentId: string
  confidence: number
  reasoning: string
}

export interface AutoFillResult {
  description: string
  mode: 'once' | 'cron'
  cronExpression: string | null
  agentId: string | null
  departmentId: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
}
