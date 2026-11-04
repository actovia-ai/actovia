import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({
  computerUse: {
    enabled: true,
    targetAllowlist: ['Chess'],
    maxSteps: 3,
    browser: { enabled: true, headed: false, maxSteps: 100 }
  }
}))
const run = vi.hoisted(() => vi.fn())
vi.mock('@main/lib/db/queries', () => ({ getSettings: async () => settings }))
vi.mock('@main/lib/automation/runtime', () => ({
  runAutomation: run,
  listDesktopApps: async () => [
    { name: 'Chess', bundleId: 'com.apple.Chess' },
    { name: 'Actovia', bundleId: 'app.yancey.actovia' }
  ]
}))
vi.mock('@main/lib/computer/liveness', () => ({
  liveness: { start: vi.fn(), end: vi.fn() }
}))
vi.mock('@main/lib/computer/self', () => ({
  isSelfTarget: ({ bundleId }: { bundleId: string }) =>
    bundleId === 'app.yancey.actovia',
  SELF_TARGET_MESSAGE: 'Cannot control self'
}))
const { computerUse } = await import('@main/lib/ai/calling-tools/computer-use')
const { browserUse } = await import('@main/lib/ai/calling-tools/browser-use')

describe('upstream automation bindings', () => {
  beforeEach(() => {
    settings.computerUse.browser = {
      enabled: true,
      headed: false,
      maxSteps: 100
    }
    run.mockReset()
    run.mockResolvedValue({
      text: '{"ok":true,"data":{"ref_id":"@snapshot:e1"}}',
      failed: false
    })
  })
  it('binds an exact app and accepts only refs observed by this run', async () => {
    const tool = computerUse()
    await tool.execute('1', {
      target: 'com.apple.Chess',
      command: 'snapshot',
      args: ['-i']
    })
    expect(run).toHaveBeenCalledWith(
      'agent-desktop',
      ['snapshot', '-i', '--app', 'Chess'],
      expect.any(AbortSignal)
    )
    await tool.execute('2', {
      target: 'Chess',
      command: 'click',
      args: ['@snapshot:e1']
    })
    expect(run).toHaveBeenCalledTimes(2)
    await computerUse().execute('3', {
      target: 'Chess',
      command: 'click',
      args: ['@snapshot:e1']
    })
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('refuses other apps, self-control and targeting overrides', async () => {
    const tool = computerUse()
    for (const target of ['Actovia', 'Not Chess', 'Chess']) {
      await tool.execute('1', {
        target,
        command: 'snapshot',
        args: ['--headed']
      })
    }
    expect(run).not.toHaveBeenCalled()
  })
  it('stops after the configured action budget', async () => {
    const tool = computerUse()
    for (let i = 0; i < 5; i++)
      await tool.execute(String(i), {
        target: 'Chess',
        command: 'snapshot',
        args: []
      })
    expect(run).toHaveBeenCalledTimes(3)
  })
  it('applies browser visibility and budget, and always permits closing', async () => {
    settings.computerUse.browser = { enabled: true, headed: true, maxSteps: 1 }
    const tool = browserUse()
    await tool.execute('open', {
      command: 'open',
      args: ['https://example.com']
    })
    expect(run.mock.calls[0][1]).toContain('--headed')
    await expect(
      tool.execute('over', { command: 'snapshot', args: [] })
    ).rejects.toThrow('budget')
    settings.computerUse.browser.enabled = false
    await expect(
      tool.execute('disabled', { command: 'snapshot', args: [] })
    ).rejects.toThrow('disabled')
    await tool.execute('close', { command: 'close', args: [] })
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('keeps browser sessions private and passes text literally', async () => {
    const a = browserUse()
    const b = browserUse()
    await a.execute('1', { command: 'open', args: ['https://example.com'] })
    await b.execute('2', {
      command: 'fill',
      args: ['@e1', '$(touch /tmp/not-a-command)']
    })
    const first = run.mock.calls[0][1]
    const second = run.mock.calls[1][1]
    expect(first[1]).not.toBe(second[1])
    expect(second.at(-1)).toBe('$(touch /tmp/not-a-command)')
    await expect(
      a.execute('3', { command: 'open', args: ['--cdp=9222'] })
    ).rejects.toThrow('managed')
  })
})
