import { randomUUID } from 'node:crypto'

import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { StringEnum, Type } from '@earendil-works/pi-ai'

import { listDesktopApps, runAutomation } from '../../automation/runtime'
import { Guard } from '../../computer/guard'
import { liveness } from '../../computer/liveness'
import { isSelfTarget, SELF_TARGET_MESSAGE } from '../../computer/self'
import { getSettings } from '../../db/queries'

const commands = [
  'skills',
  'status',
  'snapshot',
  'click',
  'right-click',
  'type',
  'set-value',
  'clear',
  'focus',
  'select',
  'toggle',
  'check',
  'uncheck',
  'expand',
  'collapse',
  'scroll',
  'scroll-to',
  'get',
  'is',
  'press'
] as const
const schema = Type.Object({
  target: Type.String({
    description: 'Exact allowlisted running app name or bundle ID.'
  }),
  command: StringEnum([...commands]),
  args: Type.Array(Type.String(), {
    description:
      'Upstream CLI arguments, one per item. First read skills: ["get", "desktop"], then ["get", "platform"]. Snapshot: ["-i", "--compact"]. Actions use a qualified ref from your snapshot.'
  })
})

/** Each binding owns its refs; another employee cannot use them. */
export function computerUse(): AgentTool<typeof schema> {
  const refs = new Map<string, string>()
  let steps = 0
  let stopped = false
  return {
    name: TOOL_NAMES.computerUse,
    label: 'Computer Use',
    description:
      'See and operate desktop apps using the bundled agent-desktop CLI. Read its version-matched skills first. Observe with snapshot, act on qualified refs, then snapshot again to verify. Strict headless accessibility actions. On stale refs, observe again. Retry an action only if the upstream disposition says retry=safe. Ask only for credentials, unavailable permissions or owner-only decisions.',
    parameters: schema,
    execute: async (_id, { target, command, args }, signal) => {
      const fail = (text: string) => ({
        content: [{ type: 'text' as const, text }],
        details: { error: text }
      })
      if (stopped)
        return fail('Desktop actions were stopped. Wait for the owner.')
      const settings = await getSettings()
      if (!settings.computerUse?.enabled)
        return fail('Computer Use is disabled in Settings.')
      if (command === 'skills' || command === 'status') {
        if (
          command === 'skills' &&
          !['get desktop', 'get platform'].includes(args.join(' '))
        )
          return fail(
            'Read skills with ["get", "desktop"] or ["get", "platform"].'
          )
        if (command === 'status' && args.length)
          return fail('status takes no arguments.')
        const result = await runAutomation(
          'agent-desktop',
          [command, ...args],
          signal
        )
        return {
          content: [{ type: 'text', text: result.text }],
          details: {
            engine: 'agent-desktop',
            command,
            ...(result.failed ? { error: result.text } : {})
          }
        }
      }
      const norm = (s: string) => s.trim().toLowerCase()
      const apps = await listDesktopApps(signal)
      const matches = apps.filter((a) =>
        [a.name, a.bundleId].some((v) => norm(v) === norm(target))
      )
      if (matches.length !== 1)
        return fail(
          'Choose one exact running app from the allowlist; start it first if needed.'
        )
      const app = matches[0]
      if (
        isSelfTarget({ bundleId: app.bundleId }) ||
        /^(actovia|electron)$/i.test(app.name)
      )
        return fail(SELF_TARGET_MESSAGE)
      if (
        !(settings.computerUse.targetAllowlist ?? []).some((a) =>
          [app.name, app.bundleId].some((v) => norm(v) === norm(a))
        )
      )
        return fail(`Target "${target}" is not on the allowlist.`)
      if (
        args.some(
          (a) =>
            /^--(?:app|window-id|session|agent-id|headed|force|debug|screenshot|trace|surface)(?:=|$)/.test(
              a
            ) || a === '-v'
        )
      )
        return fail(
          'Target, session, headed mode and file output are managed by Actovia.'
        )
      const usedRefs = args.filter((a) => /^@[^\s]+:e\d+$/.test(a))
      if (usedRefs.some((ref) => refs.get(ref) !== app.name))
        return fail('Use a ref from your own snapshot of this app.')
      if (command !== 'snapshot' && command !== 'press' && !usedRefs.length)
        return fail('Observe with snapshot first, then act on a qualified ref.')
      if (++steps > (settings.computerUse.maxSteps ?? 25))
        return fail(
          'Action budget reached. Stop and report the blocker; do not retry in another way.'
        )
      const guard = new Guard()
      guard.signal.addEventListener(
        'abort',
        () => {
          stopped = true
        },
        { once: true }
      )
      const sessionId = randomUUID()
      liveness.start(sessionId, guard)
      try {
        const result = await runAutomation(
          'agent-desktop',
          [
            command,
            ...args,
            ...(command === 'snapshot' || command === 'press'
              ? ['--app', app.name]
              : [])
          ],
          signal ? AbortSignal.any([signal, guard.signal]) : guard.signal
        )
        if (!result.failed && command === 'snapshot') {
          for (const [ref, owner] of refs)
            if (owner === app.name) refs.delete(ref)
          for (const ref of result.text.match(/@[^\s"\\]+:e\d+/g) ?? [])
            refs.set(ref, app.name)
        }
        return {
          content: [{ type: 'text', text: result.text }],
          details: {
            engine: 'agent-desktop',
            command,
            target: app.name,
            ...(result.failed ? { error: result.text } : {})
          }
        }
      } finally {
        liveness.end(sessionId)
      }
    }
  }
}
