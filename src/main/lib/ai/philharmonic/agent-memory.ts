import { z } from 'zod'

import {
  createEmployeeExperience,
  getEmployeeExperience,
  getTaskById
} from '../../db/philharmonic-queries'
import { getSettings } from '../../db/queries'
import { logger } from '../../logger'
import { knownSecretValues } from '../../secrets/known'
import { scrubSecrets } from '../../secrets/scrub'
import { getModelFromProvider } from '../utils/chat-message-util'
import { completeSimple } from '../utils/complete'
import { extractTextFromCompletion } from '../utils/llm-response-util'

const ReflectionSchema = z.object({
  lessons: z.array(
    z.object({
      title: z.string().trim().min(1),
      lesson: z.string().trim().min(1)
    })
  )
})

const REFLECTION_PROMPT = `Review a completed employee task after the PM has accepted it.
Extract only durable, reusable lessons about methods, pitfalls, or improvements that would help this same employee on future work in other Groups.
Do not restate the deliverable, invent facts, include secrets or private user data, or turn task-specific details into general rules. Return at most 5 concise lessons. If there is nothing reusable, return an empty lessons array.
Respond only with JSON: {"lessons":[{"title":"short topic","lesson":"actionable reusable lesson"}]}`

function taskOutput(output: unknown): string {
  if (typeof output !== 'object' || output === null || Array.isArray(output))
    return ''
  const result = 'result' in output ? output.result : undefined
  return typeof result === 'string' ? result : ''
}

function hasBlockedQuestion(output: unknown): boolean {
  return (
    typeof output === 'object' && output !== null && 'blockedQuestion' in output
  )
}

/**
 * Learn only after the PM accepts a completed task. These compact lessons are
 * employee-scoped rather than Group-scoped; ordinary task notes stay local.
 * Reflection is a best-effort side effect and never changes task status.
 */
export async function reflectOnReviewedTask(args: {
  taskId: string
  conversationId: string
  pmReview: string
}): Promise<void> {
  try {
    const task = await getTaskById(args.taskId)
    if (
      !task ||
      task.status !== 'completed' ||
      task.conversationId !== args.conversationId ||
      !task.assignedAgentId ||
      hasBlockedQuestion(task.output)
    )
      return

    if (await getEmployeeExperience(task.assignedAgentId, task.id)) return

    const output = taskOutput(task.output)
    const instructions = task.description?.trim() ?? ''
    if (!instructions || !output.trim()) return

    const secrets = await knownSecretValues()
    const safeInstructions = scrubSecrets(instructions, secrets)
    const safeOutput = scrubSecrets(output, secrets)
    const safeReview = scrubSecrets(args.pmReview, secrets)
    const setting = await getSettings()
    const { model, apiKey } = getModelFromProvider(setting)
    const result = await completeSimple(
      model,
      {
        systemPrompt: REFLECTION_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Task: ${safeInstructions.slice(0, 2500)}\n\nEmployee result: ${safeOutput.slice(0, 6000)}\n\nPM review: ${safeReview.slice(0, 1800)}`
              }
            ],
            timestamp: Date.now()
          }
        ]
      },
      { apiKey }
    )
    const reflection = ReflectionSchema.safeParse(
      JSON.parse(extractTextFromCompletion(result.content))
    )
    if (!reflection.success) {
      logger.warn('philharmonic', 'employee task reflection was invalid', {
        taskId: task.id,
        agentId: task.assignedAgentId,
        error: reflection.error
      })
      return
    }

    const lessons = reflection.data.lessons
      .map((lesson) => ({
        title: scrubSecrets(lesson.title, secrets).slice(0, 100).trim(),
        lesson: scrubSecrets(lesson.lesson, secrets).slice(0, 360).trim()
      }))
      .filter((lesson) => lesson.title && lesson.lesson)
      .slice(0, 5)
    if (lessons.length === 0) return

    await createEmployeeExperience({
      agentId: task.assignedAgentId,
      conversationId: null,
      key: `reviewed-task:${task.id}`,
      value: {
        task: safeInstructions.slice(0, 180),
        lessons,
        reviewedAt: new Date().toISOString()
      },
      source: 'task',
      confidence: 0.85
    })
  } catch (error) {
    logger.warn('philharmonic', 'employee task reflection failed', {
      taskId: args.taskId,
      conversationId: args.conversationId,
      error
    })
  }
}
