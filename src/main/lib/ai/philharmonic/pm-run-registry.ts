import type { Attachment } from '@actovia/shared/types/chat'
import type { GroupMention } from '@actovia/shared/types/philharmonic'

type Round = (signal: AbortSignal) => Promise<void>
type Job = {
  round: Round
  owner: boolean
  resolve(): void
  reject(error: unknown): void
}
export interface OwnerInput {
  text: string
  mentions?: GroupMention[]
  attachments?: Attachment[]
  messageId?: string
}
const controllers = new Map<string, AbortController>()
const queues = new Map<string, Job[]>()
const steering = new Map<string, OwnerInput[]>()
const accepting = new Set<string>()
const running = new Set<string>()

async function drain(id: string) {
  if (running.has(id)) return
  running.add(id)
  try {
    while (queues.get(id)?.length) {
      const queue = queues.get(id)!
      const index = queue.findIndex((job) => job.owner)
      const [job] = queue.splice(index < 0 ? 0 : index, 1)
      const controller = new AbortController()
      controllers.set(id, controller)
      try {
        await job.round(controller.signal)
        job.resolve()
      } catch (error) {
        job.reject(error)
      } finally {
        accepting.delete(id)
        steering.delete(id)
        if (controllers.get(id) === controller) controllers.delete(id)
      }
    }
  } finally {
    running.delete(id)
    queues.delete(id)
  }
}

export const pmRunRegistry = {
  set(id: string, controller: AbortController) {
    controllers.set(id, controller)
  },
  run(id: string, round: Round, owner = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const queue = queues.get(id) ?? []
      queue.push({ round, owner, resolve, reject })
      queues.set(id, queue)
      void Promise.resolve().then(() => drain(id))
    })
  },
  openSteering(id: string) {
    accepting.add(id)
  },
  closeSteering(id: string) {
    accepting.delete(id)
  },
  steer(id: string, input: OwnerInput): boolean {
    if (!accepting.has(id) || controllers.get(id)?.signal.aborted) return false
    const pending = steering.get(id) ?? []
    pending.push(input)
    steering.set(id, pending)
    return true
  },
  pendingMessageIds(id: string): Set<string> {
    return new Set(
      (steering.get(id) ?? []).flatMap((input) =>
        input.messageId ? [input.messageId] : []
      )
    )
  },
  takeSteering(id: string): OwnerInput[] {
    const pending = steering.get(id) ?? []
    steering.delete(id)
    return pending
  },
  clear(id: string) {
    controllers.delete(id)
    accepting.delete(id)
    steering.delete(id)
  },
  has(id: string) {
    return controllers.has(id)
  },
  abort(id: string): boolean {
    const c = controllers.get(id)
    accepting.delete(id)
    steering.delete(id)
    for (const job of queues.get(id)?.splice(0) ?? []) job.resolve()
    c?.abort()
    return !!c
  }
}
