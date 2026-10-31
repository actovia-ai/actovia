import type { TaskData } from '@/stores/philharmonic'

export const taskOriginId = (task: TaskData): string =>
  task.conversationId ??
  (typeof task.input?.chatId === 'string' ? task.input.chatId : '')
