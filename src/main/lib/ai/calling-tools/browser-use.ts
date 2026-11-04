import { randomUUID } from 'node:crypto'

import { SETTING_DEFAULTS } from '@actovia/shared/constants/setting-defaults'
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { StringEnum, Type } from '@earendil-works/pi-ai'

import { runAutomation } from '../../automation/runtime'
import { Guard } from '../../computer/guard'
import { liveness } from '../../computer/liveness'
import { getSettings } from '../../db/queries'

const schema = Type.Object({
  command: StringEnum([
    'skills',
    'open',
    'snapshot',
    'click',
    'dblclick',
    'fill',
    'type',
    'press',
    'keyboard',
    'hover',
    'focus',
    'select',
    'check',
    'uncheck',
    'scroll',
    'scrollintoview',
    'get',
    'is',
    'find',
    'wait',
    'tab',
    'back',
    'forward',
    'reload',
    'dialog',
    'console',
    'errors',
    'close'
  ]),
  args: Type.Array(Type.String(), {
    description:
      'agent-browser arguments, one per item. First read skills ["get", "core"]. Then open a URL, snapshot -i, act on @refs, and observe again to verify.'
  })
})

/** The upstream daemon owns the browser. Each agent run gets a private session. */
export function browserUse(): AgentTool<typeof schema> {
  const session = `actovia-${randomUUID()}`
  let calls = 0
  let opened = false
  let stopped = false
  let headed: boolean | undefined
  const tool: AgentTool<typeof schema> & { dispose(): Promise<void> } = {
    async dispose() {
      if (opened) {
        opened = false
        await runAutomation('agent-browser', ['--session', session, 'close'])
      }
    },
    name: TOOL_NAMES.browserUse,
    label: 'Browser Use',
    description:
      'Drive a private browser with the bundled agent-browser CLI. Read skills get core first; use open → snapshot -i → act → snapshot to verify. Refs expire when the page changes. Browser state persists between calls. Navigate and interact yourself. Ask only for credentials, CAPTCHA and owner-only decisions. Close the browser when finished.',
    parameters: schema,
    execute: async (_id, { command, args }, signal) => {
      const options = (await getSettings()).computerUse?.browser
      if (options?.enabled === false && command !== 'close')
        throw new Error('Browser Use is disabled in Settings.')
      if (stopped && command !== 'close')
        throw new Error('Browser actions were stopped. Wait for the owner.')
      if (
        args.some((a) =>
          /^--(?:session|namespace|cdp|auto-connect|profile|config|provider|engine|executable-path|extension|args|all|headed|restore)(?:=|$)/.test(
            a
          )
        ) ||
        args.includes('-p')
      )
        throw new Error(
          'Browser connection and session flags are managed by Actovia.'
        )
      if (
        command !== 'close' &&
        ++calls > (options?.maxSteps ?? SETTING_DEFAULTS.browserUse.maxSteps)
      )
        throw new Error(
          'Browser action budget reached. Stop and report the blocker.'
        )
      const guard = new Guard()
      guard.signal.addEventListener(
        'abort',
        () => {
          stopped = true
        },
        { once: true }
      )
      if (command !== 'skills' && command !== 'close') {
        headed ??= options?.headed ?? SETTING_DEFAULTS.browserUse.headed
        opened = true
      }
      if (command === 'close') opened = false
      const id = randomUUID()
      liveness.start(id, guard)
      try {
        const result = await runAutomation(
          'agent-browser',
          [
            '--session',
            session,
            ...(headed ? ['--headed'] : []),
            '--json',
            command,
            ...args
          ],
          signal ? AbortSignal.any([signal, guard.signal]) : guard.signal
        )
        return {
          content: [{ type: 'text', text: result.text }],
          details: {
            engine: 'agent-browser',
            command,
            ...(result.failed ? { error: result.text } : {})
          }
        }
      } finally {
        liveness.end(id)
      }
    }
  }
  return tool
}
