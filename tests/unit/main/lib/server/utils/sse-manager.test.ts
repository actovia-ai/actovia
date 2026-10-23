import { SseManager } from '@main/lib/server/utils/sse-manager'
import { describe, it, expect, vi } from 'vitest'

function makeController(): ReadableStreamDefaultController {
  return {
    enqueue: vi.fn(),
    close: vi.fn()
  } as unknown as ReadableStreamDefaultController
}

describe('SseManager', () => {
  it('registers and unregisters clients', () => {
    const manager = new SseManager<string>()
    const controller = makeController()
    manager.register('task-1', controller)
    expect(manager.hasClients('task-1')).toBe(true)
    manager.unregister('task-1', controller)
    expect(manager.hasClients('task-1')).toBe(false)
  })

  it('emits to specific topic clients', () => {
    const manager = new SseManager<string>()
    const controller = makeController()
    manager.register('task-1', controller)
    manager.emit('task-1', { type: 'update', data: 'hello' })
    expect(controller.enqueue).toHaveBeenCalled()
  })

  it('emits to global clients', () => {
    const manager = new SseManager<string>()
    const controller = makeController()
    manager.registerGlobal(controller)
    manager.emitGlobal({ type: 'update', data: 'hello' })
    expect(controller.enqueue).toHaveBeenCalled()
  })

  it('cleans up on abort signal', () => {
    const manager = new SseManager<string>()
    const controller = makeController()
    const abortController = new AbortController()
    manager.register('task-1', controller, abortController.signal)
    abortController.abort()
    expect(manager.hasClients('task-1')).toBe(false)
  })

  it('removes client on enqueue error', () => {
    const manager = new SseManager<string>()
    const controller = {
      enqueue: vi.fn().mockImplementation(() => {
        throw new Error('closed')
      }),
      close: vi.fn()
    } as unknown as ReadableStreamDefaultController
    manager.register('task-1', controller)
    manager.emit('task-1', { type: 'update', data: 'hello' })
    expect(manager.hasClients('task-1')).toBe(false)
  })

  it('encodes event and emits raw payload', () => {
    const manager = new SseManager<string>()
    const controller = makeController()
    manager.register('task-1', controller)
    const payload = manager.encodeEvent({ type: 'test', value: 42 })
    manager.emitRaw('task-1', payload)
    expect(controller.enqueue).toHaveBeenCalledWith(payload)
  })

  it('emits global raw payload', () => {
    const manager = new SseManager<string>()
    const controller = makeController()
    manager.registerGlobal(controller)
    const payload = manager.encodeEvent({ type: 'test' })
    manager.emitGlobalRaw(payload)
    expect(controller.enqueue).toHaveBeenCalledWith(payload)
  })
})

describe('startHeartbeat', () => {
  const decode = (c: ReadableStreamDefaultController) =>
    (c.enqueue as ReturnType<typeof vi.fn>).mock.calls.map(([bytes]) =>
      new TextDecoder().decode(bytes as Uint8Array)
    )

  // URLSession hands a client an event stream's response only with its first
  // byte: without one at once, a quiet stream reads as unopened for 15 s.
  it('sends a comment line at once, then every interval', async () => {
    vi.useFakeTimers()
    try {
      const { startHeartbeat, SSE_HEARTBEAT_MS } =
        await import('@main/lib/server/utils/sse-manager')
      const controller = makeController()
      startHeartbeat(controller)
      expect(decode(controller)).toEqual([': ping\n\n'])
      vi.advanceTimersByTime(SSE_HEARTBEAT_MS * 2)
      expect(SSE_HEARTBEAT_MS).toBe(15_000)
      expect(decode(controller)).toEqual([
        ': ping\n\n',
        ': ping\n\n',
        ': ping\n\n'
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops when the request aborts', async () => {
    vi.useFakeTimers()
    try {
      const { startHeartbeat } =
        await import('@main/lib/server/utils/sse-manager')
      const controller = makeController()
      const abort = new AbortController()
      startHeartbeat(controller, abort.signal)
      abort.abort()
      vi.advanceTimersByTime(60_000)
      // Only the one sent at once.
      expect(controller.enqueue).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops when the controller is closed', async () => {
    vi.useFakeTimers()
    try {
      const { startHeartbeat } =
        await import('@main/lib/server/utils/sse-manager')
      const controller = makeController()
      ;(controller.enqueue as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          throw new TypeError('Invalid state: Controller is already closed')
        }
      )
      startHeartbeat(controller, undefined, 1000)
      expect(() => vi.advanceTimersByTime(5000)).not.toThrow()
      expect(controller.enqueue).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
