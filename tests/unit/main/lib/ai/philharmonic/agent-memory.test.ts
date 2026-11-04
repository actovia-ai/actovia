import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createEmployeeExperience: vi.fn(async () => ({ id: 'memory' })),
  getEmployeeExperience: vi.fn(async () => undefined),
  getTaskById: vi.fn(async () => ({
    id: 'task',
    status: 'completed',
    conversationId: 'group',
    assignedAgentId: 'employee',
    description: 'Prepare a report',
    output: { result: 'Report is ready with a credential sk-test-123.' }
  })),
  getSettings: vi.fn(async () => ({ id: 'settings' })),
  knownSecretValues: vi.fn(async () => ['sk-test-123']),
  completeSimple: vi.fn(async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          lessons: [
            { title: 'Validate inputs', lesson: 'Check source data first.' }
          ]
        })
      }
    ]
  })),
  warn: vi.fn()
}))

vi.mock('@main/lib/db/philharmonic-queries', () => ({
  createEmployeeExperience: mocks.createEmployeeExperience,
  getEmployeeExperience: mocks.getEmployeeExperience,
  getTaskById: mocks.getTaskById
}))
vi.mock('@main/lib/db/queries', () => ({
  getSettings: mocks.getSettings
}))
vi.mock('@main/lib/secrets/known', () => ({
  knownSecretValues: mocks.knownSecretValues
}))
vi.mock('@main/lib/ai/utils/chat-message-util', () => ({
  getModelFromProvider: () => ({ model: { id: 'test' }, apiKey: 'key' })
}))
vi.mock('@main/lib/ai/utils/complete', () => ({
  completeSimple: mocks.completeSimple
}))
vi.mock('@main/lib/logger', () => ({
  logger: { warn: mocks.warn }
}))

const { reflectOnReviewedTask } =
  await import('@main/lib/ai/philharmonic/agent-memory')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('reflectOnReviewedTask', () => {
  it('stores redacted lessons for a completed task after the PM review', async () => {
    await reflectOnReviewedTask({
      taskId: 'task',
      conversationId: 'group',
      pmReview: 'Accepted; do not expose sk-test-123.'
    })

    expect(mocks.completeSimple).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: [
              expect.objectContaining({
                text: expect.not.stringContaining('sk-test-123')
              })
            ]
          })
        ]
      }),
      { apiKey: 'key' }
    )
    expect(mocks.createEmployeeExperience).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'employee',
        conversationId: null,
        key: 'reviewed-task:task',
        source: 'task',
        value: expect.objectContaining({
          lessons: [
            {
              title: 'Validate inputs',
              lesson: 'Check source data first.'
            }
          ]
        })
      })
    )
  })

  it('does not reflect work until a completed task is reviewed', async () => {
    mocks.getTaskById.mockResolvedValueOnce({
      id: 'task',
      status: 'running',
      conversationId: 'group',
      assignedAgentId: 'employee',
      description: 'Prepare a report',
      output: { result: 'Report is ready.' }
    } as never)

    await reflectOnReviewedTask({
      taskId: 'task',
      conversationId: 'group',
      pmReview: 'Accepted'
    })

    expect(mocks.completeSimple).not.toHaveBeenCalled()
    expect(mocks.createEmployeeExperience).not.toHaveBeenCalled()
  })

  it('ignores legacy non-object task output without warning', async () => {
    mocks.getTaskById.mockResolvedValueOnce({
      id: 'task',
      status: 'completed',
      conversationId: 'group',
      assignedAgentId: 'employee',
      description: 'Prepare a report',
      output: 'legacy output'
    } as never)

    await reflectOnReviewedTask({
      taskId: 'task',
      conversationId: 'group',
      pmReview: 'Accepted'
    })

    expect(mocks.completeSimple).not.toHaveBeenCalled()
    expect(mocks.warn).not.toHaveBeenCalled()
  })

  it('keeps reflection failures from escaping the task completion path', async () => {
    mocks.completeSimple.mockRejectedValueOnce(new Error('offline'))

    await expect(
      reflectOnReviewedTask({
        taskId: 'task',
        conversationId: 'group',
        pmReview: 'Accepted'
      })
    ).resolves.toBeUndefined()
    expect(mocks.warn).toHaveBeenCalled()
  })
})
