import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSettings = vi.fn()
const runComputerSession = vi.fn()
const livenessStart = vi.fn()
const livenessEnd = vi.fn()

vi.mock('@main/lib/db/queries', () => ({
  getSettings: (...a: unknown[]) => getSettings(...a)
}))
vi.mock('@main/lib/computer/session', () => ({
  runComputerSession: (...a: unknown[]) => runComputerSession(...a)
}))
vi.mock('@main/lib/ai/utils/chat-message-util', () => ({
  getModelFromProvider: () => ({ chatModel: {}, apiKey: 'k' })
}))
vi.mock('@main/lib/ai/computer-use/agent', () => ({
  ClaudeComputerAgent: class {}
}))
vi.mock('@main/lib/computer/liveness', () => ({
  liveness: {
    start: (...a: unknown[]) => livenessStart(...a),
    end: (...a: unknown[]) => livenessEnd(...a)
  }
}))
vi.mock('@main/lib/computer/guard', () => ({
  Guard: class {}
}))

const { computerUse } = await import('@main/lib/ai/calling-tools/computer-use')

describe('computerUse tool', () => {
  beforeEach(() => {
    getSettings.mockReset()
    runComputerSession.mockReset()
    livenessStart.mockReset()
    livenessEnd.mockReset()
  })

  it('returns a disabled message when Computer Use is off', async () => {
    getSettings.mockResolvedValue({ computerUse: { enabled: false } })

    const res = await computerUse.execute('call-1', {
      task: 'do a thing',
      target: 'Chess'
    })

    expect(res.content[0]).toMatchObject({
      type: 'text',
      text: 'Computer Use is disabled in settings.'
    })
    expect(res.details.error).toBe('disabled')
    expect(runComputerSession).not.toHaveBeenCalled()
  })

  it.each(['app.yancey.actovia', ' App.Yancey.Actovia '])(
    'never targets Actovia itself (%s), even when allowlisted',
    async (target) => {
      getSettings.mockResolvedValue({
        computerUse: {
          enabled: true,
          targetAllowlist: ['app.yancey.actovia', 'App.Yancey.Actovia']
        }
      })
      const res = await computerUse.execute('call-1', {
        task: 'click Allow once',
        target
      })
      expect(res.details.error).toBe('self')
      expect(res.content[0].text).toContain('cannot control its own window')
      expect(runComputerSession).not.toHaveBeenCalled()
    }
  )

  it('rejects a target that is not on the allowlist', async () => {
    getSettings.mockResolvedValue({
      computerUse: { enabled: true, targetAllowlist: ['Chess'] }
    })

    const res = await computerUse.execute('call-1', {
      task: 'do a thing',
      target: 'Safari'
    })

    expect(res.content[0].text).toContain('not on the allowlist')
    expect(res.details.error).toBe('not-allowed')
    expect(runComputerSession).not.toHaveBeenCalled()
  })

  it('rejects a target that only contains an allowlisted name as a substring', async () => {
    getSettings.mockResolvedValue({
      computerUse: { enabled: true, targetAllowlist: ['Chess'] }
    })

    const res = await computerUse.execute('call-1', {
      task: 'do a thing',
      target: 'Not Chess'
    })

    expect(res.details.error).toBe('not-allowed')
    expect(runComputerSession).not.toHaveBeenCalled()
  })

  it('allows an exact allowlist match regardless of case/whitespace', async () => {
    getSettings.mockResolvedValue({
      computerUse: { enabled: true, targetAllowlist: ['Chess'] }
    })
    runComputerSession.mockResolvedValue({
      outcome: 'success',
      summary: 'ok',
      steps: 1
    })

    const res = await computerUse.execute('call-1', {
      task: 'do a thing',
      target: '  chess  '
    })

    expect(res.details.outcome).toBe('success')
    expect(runComputerSession).toHaveBeenCalledTimes(1)
  })

  it('runs a session for an allowed target and returns its summary', async () => {
    getSettings.mockResolvedValue({
      computerUse: { enabled: true, targetAllowlist: ['Chess'] }
    })
    runComputerSession.mockResolvedValue({
      outcome: 'success',
      summary: 'done',
      steps: 2
    })

    const res = await computerUse.execute('call-1', {
      task: 'win the game',
      target: 'Chess'
    })

    expect(res.content[0]).toMatchObject({ type: 'text', text: 'done' })
    expect(res.details.outcome).toBe('success')
    expect(res.details.steps).toBe(2)
    expect(res.details.summary).toBe('done')
    expect(livenessStart).toHaveBeenCalledTimes(1)
    expect(livenessEnd).toHaveBeenCalledTimes(1)
  })

  it('appends the final screenshot as an image block', async () => {
    getSettings.mockResolvedValue({
      computerUse: { enabled: true, targetAllowlist: ['Chess'] }
    })
    runComputerSession.mockResolvedValue({
      outcome: 'success',
      summary: 'done',
      steps: 1,
      finalScreenshot: {
        data: 'base64png',
        mimeType: 'image/png',
        width: 800,
        height: 600
      }
    })

    const res = await computerUse.execute('call-1', {
      task: 'win the game',
      target: 'Chess'
    })

    expect(res.content).toHaveLength(2)
    expect(res.content[1]).toMatchObject({
      type: 'image',
      data: 'base64png',
      mimeType: 'image/png'
    })
  })

  it('does not throw when the session rejects, and still ends liveness', async () => {
    getSettings.mockResolvedValue({
      computerUse: { enabled: true, targetAllowlist: ['Chess'] }
    })
    runComputerSession.mockRejectedValue(new Error('helper crashed'))

    const res = await computerUse.execute('call-1', {
      task: 'win the game',
      target: 'Chess'
    })

    expect(res.content[0].text).toContain('helper crashed')
    expect(res.details.error).toContain('helper crashed')
    expect(livenessEnd).toHaveBeenCalledTimes(1)
  })

  it('streams session updates through onUpdate, stamped with the sessionId', async () => {
    getSettings.mockResolvedValue({
      computerUse: { enabled: true, targetAllowlist: ['Chess'] }
    })
    let sessionId = ''
    runComputerSession.mockImplementation(
      async (opts: { sessionId: string; onUpdate?: (u: unknown) => void }) => {
        sessionId = opts.sessionId
        opts.onUpdate?.({ step: 1, action: 'click' })
        return { outcome: 'success', summary: 'done', steps: 1 }
      }
    )
    const onUpdate = vi.fn()

    await computerUse.execute(
      'call-1',
      { task: 'go', target: 'Chess' },
      undefined,
      onUpdate
    )

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const arg = onUpdate.mock.calls[0][0]
    // The panel needs the sessionId on every frame to answer an askHuman
    // prompt before the terminal result lands — SessionUpdate itself omits it.
    expect(sessionId).toBeTruthy()
    expect(arg.details).toEqual({ step: 1, action: 'click', sessionId })
    expect(arg.content[0].text).toBe(
      JSON.stringify({ step: 1, action: 'click', sessionId })
    )
  })

  it('keeps the frame thumbnail in details but strips it from the text block', async () => {
    getSettings.mockResolvedValue({
      computerUse: { enabled: true, targetAllowlist: ['Chess'] }
    })
    runComputerSession.mockImplementation(
      async (opts: { onUpdate?: (u: unknown) => void }) => {
        opts.onUpdate?.({ step: 2, action: 'click', thumbnail: 'BIGBASE64' })
        return { outcome: 'success', summary: 'done', steps: 1 }
      }
    )
    const onUpdate = vi.fn()

    await computerUse.execute(
      'call-1',
      { task: 'go', target: 'Chess' },
      undefined,
      onUpdate
    )

    const arg = onUpdate.mock.calls[0][0]
    const parsed = JSON.parse(arg.content[0].text)
    expect('thumbnail' in parsed).toBe(false)
    expect(parsed).toMatchObject({ step: 2, action: 'click' })
    // details still carries the full frame for the card
    expect(arg.details.thumbnail).toBe('BIGBASE64')
  })
})
