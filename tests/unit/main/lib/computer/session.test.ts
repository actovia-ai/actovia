import type { ComputerAgent } from '@main/lib/ai/computer-use/agent'
import type { SessionUpdate } from '@main/lib/computer/session'
import type {
  Action,
  ComputerState,
  TargetWindow
} from '@main/lib/computer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The session loop only touches the logger + trace-context for observability and
// the Runtime modules for the real work. `trace-context` and `ask-registry` are
// pure — use them for real. `logger` transitively pulls Electron (`paths.ts`),
// and `helper.ts` pulls `@electron-toolkit/utils`, so both are mocked. `capture`
// is mocked to skip the `nativeImage` PNG decode (spec-blessed clean path).
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getAppPath: () => '/repo' }
}))
vi.mock('@main/lib/computer/capture', () => ({
  screenshotWindow: vi.fn(async () => ({
    shot: { data: 'AAAA', mimeType: 'image/png', width: 800, height: 600 },
    scaleFactor: 1
  })),
  hashPng: (s: string) => s
}))

const { runComputerSession } = await import('@main/lib/computer/session')
const { mockHelper } = await import('@main/lib/computer/helper')
const { computerAskRegistry } = await import('@main/lib/computer/ask-registry')
const { Guard } = await import('@main/lib/computer/guard')
const { KEYCODES } = await import('@main/lib/computer/hands')
const { logger } = await import('@main/lib/logger')
const { screenshotWindow } = await import('@main/lib/computer/capture')

const chess: TargetWindow = {
  cgWindowId: 1,
  app: 'Chess',
  bundleId: 'com.apple.Chess',
  title: 'Chess',
  bounds: [0, 0, 800, 600]
}

/** A `ComputerAgent` that replays a fixed script and records what it was shown. */
class ScriptedAgent implements ComputerAgent {
  readonly seen: ComputerState[] = []

  constructor(private readonly script: Action[]) {}

  async nextAction(state: ComputerState): Promise<Action> {
    this.seen.push(structuredClone(state))
    const next = this.script.shift()
    if (!next) throw new Error('script exhausted')
    return next
  }
}

/** An agent that returns the same action forever. */
const looping = (action: Action): ComputerAgent => ({
  nextAction: async () => action
})

beforeEach(() => {
  mockHelper.__reset()
  mockHelper.__setWindows([chess])
  vi.mocked(logger.info).mockClear()
  vi.mocked(logger.warn).mockClear()
  vi.mocked(screenshotWindow).mockClear()
  vi.mocked(screenshotWindow).mockImplementation(async () => ({
    shot: { data: 'AAAA', mimeType: 'image/png', width: 800, height: 600 },
    scaleFactor: 1
  }))
})

describe('runComputerSession — happy path', () => {
  it('runs to done and emits the click + type helper commands', async () => {
    const agent = new ScriptedAgent([
      { kind: 'click', to: [10, 10] },
      { kind: 'type', text: 'hi' },
      { kind: 'done', success: true, summary: 'ok' }
    ])

    const res = await runComputerSession({
      sessionId: 's-happy',
      task: 'play a move',
      target: 'Chess',
      agent,
      helper: mockHelper,
      settleMs: 0
    })

    expect(res.outcome).toBe('success')
    expect(res.steps).toBe(3)
    expect(res.summary).toBe('ok')
    expect(res.finalScreenshot?.data).toBe('AAAA')

    const flat = mockHelper.sent.flat()
    expect(flat).toContainEqual({ op: 'move', x: 10, y: 10 })
    expect(flat).toContainEqual({ op: 'down', button: 'left' })
    expect(flat).toContainEqual({ op: 'up', button: 'left' })
    expect(flat).toContainEqual({ op: 'key', code: KEYCODES.h, down: true })
    expect(flat).toContainEqual({ op: 'key', code: KEYCODES.i, down: true })
  })

  it('tracks the cursor in screenshot space from the click terminal point', async () => {
    const agent = new ScriptedAgent([
      { kind: 'click', to: [123, 45] },
      { kind: 'done', success: true, summary: 'ok' }
    ])

    await runComputerSession({
      sessionId: 's-cursor',
      task: 't',
      target: 'Chess',
      agent,
      helper: mockHelper,
      settleMs: 0
    })

    // first frame: centre of the 800x600 screenshot
    expect(agent.seen[0].cursor).toEqual([400, 300])
    // second frame: wherever the (clamped) click landed
    expect(agent.seen[1].cursor).toEqual([123, 45])
  })

  it('maps done{success:false} to outcome:failed with the summary', async () => {
    const res = await runComputerSession({
      sessionId: 's-give-up',
      task: 't',
      target: 'Chess',
      agent: new ScriptedAgent([
        { kind: 'done', success: false, summary: 'could not find the button' }
      ]),
      helper: mockHelper,
      settleMs: 0
    })

    expect(res.outcome).toBe('failed')
    expect(res.summary).toBe('could not find the button')
    expect(res.steps).toBe(1)
  })
})

describe('runComputerSession — step cap', () => {
  it('ends failed after maxSteps without a done', async () => {
    const res = await runComputerSession({
      sessionId: 's-cap',
      task: 't',
      target: 'Chess',
      agent: looping({ kind: 'wait', ms: 1 }),
      helper: mockHelper,
      maxSteps: 3,
      settleMs: 0
    })

    expect(res.outcome).toBe('failed')
    expect(res.steps).toBe(3)
    expect(res.summary).toMatch(/step limit/i)
  })
})

describe('runComputerSession — abort', () => {
  it('returns aborted when the AbortSignal fires mid-loop', async () => {
    const controller = new AbortController()

    const res = await runComputerSession({
      sessionId: 's-abort',
      task: 't',
      target: 'Chess',
      agent: looping({ kind: 'click', to: [1, 1] }),
      helper: mockHelper,
      signal: controller.signal,
      settleMs: 0,
      onUpdate: (u) => {
        if (u.step === 2 && u.action) controller.abort()
      }
    })

    expect(res.outcome).toBe('aborted')
  })

  it('returns aborted when the guard is tripped mid-loop', async () => {
    const guard = new Guard()

    const res = await runComputerSession({
      sessionId: 's-abort-guard',
      task: 't',
      target: 'Chess',
      agent: looping({ kind: 'click', to: [1, 1] }),
      helper: mockHelper,
      guard,
      settleMs: 0,
      onUpdate: (u) => {
        if (u.step === 2 && u.action) guard.abort('user')
      }
    })

    expect(res.outcome).toBe('aborted')
  })

  it('observes a guard abort while parked in askHuman (no signal needed)', async () => {
    const guard = new Guard()

    const promise = runComputerSession({
      sessionId: 's-park-ask',
      task: 't',
      target: 'Chess',
      agent: new ScriptedAgent([{ kind: 'askHuman', question: 'code?' }]),
      helper: mockHelper,
      guard,
      settleMs: 0,
      askHumanTimeoutMs: 60_000
    })
    setTimeout(() => guard.abort('hotkey'), 10)

    expect((await promise).outcome).toBe('aborted')
  })

  it('observes a guard abort while parked in a long wait sleep', async () => {
    const guard = new Guard()

    const promise = runComputerSession({
      sessionId: 's-park-wait',
      task: 't',
      target: 'Chess',
      agent: looping({ kind: 'wait', ms: 5000 }),
      helper: mockHelper,
      guard,
      settleMs: 0
    })
    setTimeout(() => guard.abort('user'), 10)

    expect((await promise).outcome).toBe('aborted')
  })

  it('links the run AbortSignal into the guard (parked-session abort)', async () => {
    const controller = new AbortController()

    const promise = runComputerSession({
      sessionId: 's-park-signal',
      task: 't',
      target: 'Chess',
      agent: looping({ kind: 'wait', ms: 5000 }),
      helper: mockHelper,
      signal: controller.signal,
      settleMs: 0
    })
    setTimeout(() => controller.abort(), 10)

    expect((await promise).outcome).toBe('aborted')
  })
})

describe('runComputerSession — askHuman', () => {
  it('suspends, then feeds the answer into the next state as humanNote', async () => {
    const agent = new ScriptedAgent([
      { kind: 'askHuman', question: 'code?' },
      { kind: 'done', success: true, summary: 'done' }
    ])
    let askedQuestion: string | undefined

    const res = await runComputerSession({
      sessionId: 's-ask',
      task: 't',
      target: 'Chess',
      agent,
      helper: mockHelper,
      settleMs: 0,
      onUpdate: (u) => {
        if (u.awaitingHuman) {
          askedQuestion = u.awaitingHuman.question
          setTimeout(() => computerAskRegistry.resolve('s-ask', '123456'), 0)
        }
      }
    })

    expect(askedQuestion).toBe('code?')
    expect(res.outcome).toBe('success')
    expect(agent.seen).toHaveLength(2)
    expect(agent.seen[0].humanNote).toBeUndefined()
    expect(agent.seen[1].humanNote).toBe('123456')
  })

  it('returns abandoned when nobody answers before the timeout', async () => {
    const res = await runComputerSession({
      sessionId: 's-abandon',
      task: 't',
      target: 'Chess',
      agent: new ScriptedAgent([{ kind: 'askHuman', question: 'code?' }]),
      helper: mockHelper,
      settleMs: 0,
      askHumanTimeoutMs: 5
    })

    expect(res.outcome).toBe('abandoned')
  })
})

describe('runComputerSession — stuck', () => {
  it('asks for guidance once, then ends stuck on the second frozen frame', async () => {
    let asked = 0

    const res = await runComputerSession({
      sessionId: 's-stuck',
      task: 't',
      target: 'Chess',
      agent: looping({ kind: 'click', to: [5, 5] }),
      helper: mockHelper,
      settleMs: 0,
      onUpdate: (u) => {
        if (u.awaitingHuman) {
          asked += 1
          setTimeout(
            () => computerAskRegistry.resolve('s-stuck', 'keep going'),
            0
          )
        }
      }
    })

    expect(asked).toBe(1)
    expect(res.outcome).toBe('stuck')
  })

  it('never trips stuck while the agent is legitimately waiting', async () => {
    const updates: SessionUpdate[] = []

    const res = await runComputerSession({
      sessionId: 's-wait',
      task: 't',
      target: 'Chess',
      agent: looping({ kind: 'wait', ms: 1 }),
      helper: mockHelper,
      maxSteps: 8,
      settleMs: 0,
      onUpdate: (u) => updates.push(u)
    })

    expect(res.outcome).toBe('failed')
    expect(updates.filter((u) => u.awaitingHuman)).toHaveLength(0)
  })
})

describe('runComputerSession — resilience', () => {
  it('fails (not throws) when the target window cannot be resolved', async () => {
    mockHelper.__setWindows([])

    const res = await runComputerSession({
      sessionId: 's-notarget',
      task: 't',
      target: 'Nonexistent',
      agent: looping({ kind: 'wait', ms: 1 }),
      helper: mockHelper,
      settleMs: 0
    })

    expect(res.outcome).toBe('failed')
    expect(res.summary).toMatch(/nonexistent/i)
    expect(res.steps).toBe(0)
  })

  it('fails when the target window vanishes mid-session', async () => {
    const res = await runComputerSession({
      sessionId: 's-gone',
      task: 't',
      target: 'Chess',
      agent: looping({ kind: 'wait', ms: 1 }),
      helper: mockHelper,
      settleMs: 0,
      onUpdate: (u) => {
        if (u.step === 1 && u.action) mockHelper.__setWindows([])
      }
    })

    expect(res.outcome).toBe('failed')
    expect(res.summary).toMatch(/gone/i)
  })

  it('sends no input while another app’s window covers the target', async () => {
    const sheet: TargetWindow = {
      cgWindowId: 9,
      app: 'GameOverlayViewService',
      bundleId: 'com.apple.GameOverlayUI',
      title: '',
      bounds: [100, 100, 400, 300]
    }
    mockHelper.__setWindows([sheet, chess])
    const agent = new ScriptedAgent([
      { kind: 'click', to: [200, 200] },
      { kind: 'done', success: false, summary: 'blocked' }
    ])

    const res = await runComputerSession({
      sessionId: 's-covered',
      task: 't',
      target: 'Chess',
      agent,
      helper: mockHelper,
      settleMs: 0
    })

    expect(res.outcome).toBe('failed')
    expect(mockHelper.sent).toHaveLength(0)
    expect(agent.seen[1].systemNote).toContain(
      'a window of "GameOverlayViewService" is in front of the Chess window'
    )
    expect(agent.seen[1].systemNote).toContain('askHuman')
  })

  it('raises the target before every input', async () => {
    const agent = new ScriptedAgent([
      { kind: 'click', to: [10, 10] },
      { kind: 'done', success: true, summary: 'ok' }
    ])

    await runComputerSession({
      sessionId: 's-raise',
      task: 't',
      target: 'Chess',
      agent,
      helper: mockHelper,
      settleMs: 0
    })

    expect(mockHelper.activated).toEqual(['com.apple.Chess'])
  })

  it('skips an out-of-bounds coordinate without ending the session', async () => {
    const agent = new ScriptedAgent([
      { kind: 'click', to: [9000, 9000] },
      { kind: 'done', success: true, summary: 'recovered' }
    ])

    const res = await runComputerSession({
      sessionId: 's-oob',
      task: 't',
      target: 'Chess',
      agent,
      helper: mockHelper,
      settleMs: 0
    })

    expect(res.outcome).toBe('success')
    expect(res.summary).toBe('recovered')
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'computer',
      'action rejected — skipped',
      expect.objectContaining({ step: 1, reason: 'OutOfBounds' })
    )
    // nothing was sent to the helper for the bad click
    expect(mockHelper.sent).toHaveLength(0)
    // the model is told its action was dropped on the next turn
    expect(agent.seen[1].systemNote).toContain('off the')
    expect(agent.seen[1].systemNote).toContain('screenshot')
  })

  it('clamps against screenshot space, not window space (downscaled capture)', async () => {
    // A 2800-pt-wide window whose 2800 px capture is downscaled to a 1400 px
    // screenshot → scaleFactor 1400/2800 = 0.5 (screenshot px per window point).
    mockHelper.__setWindows([{ ...chess, bounds: [0, 0, 2800, 1750] }])
    vi.mocked(screenshotWindow).mockImplementation(async () => ({
      shot: { data: 'AAAA', mimeType: 'image/png', width: 1400, height: 875 },
      scaleFactor: 0.5
    }))

    const agent = new ScriptedAgent([
      { kind: 'click', to: [1300, 400] }, // inside the 1400-wide screenshot
      { kind: 'click', to: [2000, 400] }, // inside the 2800 window, off the screenshot
      { kind: 'done', success: true, summary: 'ok' }
    ])

    const res = await runComputerSession({
      sessionId: 's-retina',
      task: 't',
      target: 'Chess',
      agent,
      helper: mockHelper,
      settleMs: 0
    })

    expect(res.outcome).toBe('success')
    // the in-frame click executed — mapped back through scaleFactor 0.5
    expect(mockHelper.sent.flat()).toContainEqual({
      op: 'move',
      x: 2600,
      y: 800
    })
    // the off-screenshot click was rejected as OOB and skipped, not executed
    expect(mockHelper.sent).toHaveLength(1)
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'computer',
      'action rejected — skipped',
      expect.objectContaining({ step: 2, reason: 'OutOfBounds' })
    )
  })

  it('fails when a step exceeds the step timeout', async () => {
    const res = await runComputerSession({
      sessionId: 's-timeout',
      task: 't',
      target: 'Chess',
      agent: { nextAction: () => new Promise(() => {}) },
      helper: mockHelper,
      settleMs: 0,
      stepTimeoutMs: 5
    })

    expect(res.outcome).toBe('failed')
    expect(res.summary).toMatch(/timed out/i)
  })
})

describe('runComputerSession — forbidden chords', () => {
  it('skips a chord that would leave the window and continues', async () => {
    const agent = new ScriptedAgent([
      { kind: 'hotkey', combo: 'cmd+q' },
      { kind: 'done', success: true, summary: 'ok' }
    ])

    const res = await runComputerSession({
      sessionId: 's-chord',
      task: 't',
      target: 'Chess',
      agent,
      helper: mockHelper,
      settleMs: 0
    })

    expect(res.outcome).toBe('success')
    // the chord never reached the helper
    expect(mockHelper.sent).toHaveLength(0)
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'computer',
      'action rejected — skipped',
      expect.objectContaining({ reason: 'ForbiddenChord' })
    )
    // the model is told why on the next turn
    expect(agent.seen[1].systemNote).toMatch(/switch or quit/)
  })
})

describe('runComputerSession — allowlist', () => {
  it.each([
    [
      'its packaged bundle id',
      { bundleId: 'app.yancey.actovia', cgWindowId: 7 }
    ],
    [
      'one of its own windows',
      { bundleId: 'com.example.other', cgWindowId: 42 }
    ]
  ])(
    'never drives Actovia itself (%s), even when the user allowlisted it',
    async (_label, self) => {
      const { setSelfIdentityForTests } =
        await import('@main/lib/computer/self')
      setSelfIdentityForTests({
        bundleIds: ['app.yancey.actovia'],
        windowIds: [42]
      })
      try {
        mockHelper.__setWindows([
          {
            app: 'Actovia',
            title: 'Actovia',
            bounds: [0, 0, 800, 600],
            ...self
          }
        ])
        const res = await runComputerSession({
          sessionId: 's-self',
          task: 'click Allow once',
          target: 'Actovia',
          allowlist: ['Actovia', 'app.yancey.actovia', 'com.example.other'],
          agent: looping({ kind: 'click', to: [10, 10] }),
          helper: mockHelper,
          settleMs: 0
        })
        expect(res.outcome).toBe('failed')
        expect(res.summary).toContain('cannot control its own window')
        expect(mockHelper.sent).toHaveLength(0)
      } finally {
        setSelfIdentityForTests(null)
      }
    }
  )

  it('fails when the resolved window is not on the allowlist', async () => {
    mockHelper.__setWindows([
      {
        cgWindowId: 9,
        app: 'Chess Trainer',
        bundleId: 'com.evil.chesstrainer',
        title: 'Chess Trainer',
        bounds: [0, 0, 800, 600]
      }
    ])

    const res = await runComputerSession({
      sessionId: 's-allow-miss',
      task: 't',
      target: 'Chess',
      allowlist: ['Chess'],
      agent: looping({ kind: 'wait', ms: 1 }),
      helper: mockHelper,
      settleMs: 0
    })

    expect(res.outcome).toBe('failed')
    expect(res.summary).toContain('not on the allowlist')
    expect(mockHelper.sent).toHaveLength(0)
  })

  it('proceeds when the resolved window is on the allowlist', async () => {
    // `chess` (app "Chess") is set by beforeEach
    const agent = new ScriptedAgent([
      { kind: 'done', success: true, summary: 'ok' }
    ])

    const res = await runComputerSession({
      sessionId: 's-allow-hit',
      task: 't',
      target: 'Chess',
      allowlist: ['Chess'],
      agent,
      helper: mockHelper,
      settleMs: 0
    })

    expect(res.outcome).toBe('success')
    expect(agent.seen).toHaveLength(1)
    expect(vi.mocked(screenshotWindow)).toHaveBeenCalled()
  })

  it('launches an allowlisted app that is not open, then drives it', async () => {
    mockHelper.__setWindows([])
    mockHelper.__onActivate(() => mockHelper.__setWindows([chess]))

    const res = await runComputerSession({
      sessionId: 's-launch',
      task: 't',
      target: 'Chess',
      allowlist: ['Chess'],
      agent: new ScriptedAgent([
        { kind: 'done', success: true, summary: 'ok' }
      ]),
      helper: mockHelper,
      settleMs: 0
    })

    expect(res.outcome).toBe('success')
    expect(mockHelper.activated).toEqual(['Chess'])
  })

  it('does not launch a target that is not an exact allowlist entry', async () => {
    mockHelper.__setWindows([])

    const res = await runComputerSession({
      sessionId: 's-nolaunch',
      task: 't',
      target: 'Chess',
      allowlist: ['Safari'],
      agent: looping({ kind: 'wait', ms: 1 }),
      helper: mockHelper,
      settleMs: 0
    })

    expect(res.outcome).toBe('failed')
    expect(mockHelper.activated).toEqual([])
  })
})

describe('runComputerSession — updates', () => {
  it('always emits a terminal outcome update', async () => {
    const updates: string[] = []

    await runComputerSession({
      sessionId: 's-updates',
      task: 't',
      target: 'Chess',
      agent: new ScriptedAgent([
        { kind: 'done', success: true, summary: 'ok' }
      ]),
      helper: mockHelper,
      settleMs: 0,
      onUpdate: (u) => {
        if (u.outcome) updates.push(u.outcome)
      }
    })

    expect(updates).toEqual(['success'])
  })
})
