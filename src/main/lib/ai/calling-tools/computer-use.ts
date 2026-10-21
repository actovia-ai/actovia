import { SETTING_DEFAULTS } from '@actovia/shared/constants/setting-defaults'
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import { v4 as uuidV4 } from 'uuid'

import { Guard } from '../../computer/guard'
import { liveness } from '../../computer/liveness'
import { isSelfTarget, SELF_TARGET_MESSAGE } from '../../computer/self'
import { runComputerSession } from '../../computer/session'
import { getSettings } from '../../db/queries'
import { ClaudeComputerAgent } from '../computer-use/agent'
import { getModelFromProvider } from '../utils/chat-message-util'

const schema = Type.Object({
  task: Type.String({
    description: 'What to accomplish in the target window'
  }),
  target: Type.String({
    description:
      'App name or bundle id of the window to control. If the app is on the ' +
      "user's allowlist it will be opened automatically when it isn't running."
  })
})

export const computerUse: AgentTool<typeof schema> = {
  name: TOOL_NAMES.computerUse,
  label: 'Computer Use',
  description:
    "Operate a single window on the user's Mac with a virtual mouse and " +
    'keyboard to accomplish a task — e.g. play a game, fill a web form, click ' +
    'through an app. `target` is the app name of the window to control (must ' +
    "be on the user's allowlist). This runs a multi-step session and returns " +
    'a summary; it is slow (seconds per step) and should only be used when ' +
    "direct API/tool alternatives don't exist.",
  parameters: schema,
  execute: async (_toolCallId, { task, target }, signal, onUpdate) => {
    try {
      const s = await getSettings()

      if (!s.computerUse?.enabled) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Computer Use is disabled in settings.'
            }
          ],
          details: { error: 'disabled' }
        }
      }

      // Never Actovia itself, whatever the allowlist says: it could click its
      // own approval prompt. The session re-checks the resolved window too.
      if (isSelfTarget({ bundleId: target })) {
        return {
          content: [{ type: 'text' as const, text: SELF_TARGET_MESSAGE }],
          details: { error: 'self' }
        }
      }

      // Exact (case-insensitive) match only — substring matching would let a
      // model-supplied target like "Not Chess" slip past an allowlisted "Chess".
      const allowlist = s.computerUse.targetAllowlist ?? []
      const wanted = target.trim().toLowerCase()
      if (!allowlist.some((a) => a.trim().toLowerCase() === wanted)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Target "${target}" is not on the allowlist.`
            }
          ],
          details: { error: 'not-allowed' }
        }
      }

      const { model, apiKey } = getModelFromProvider(s)
      const agent = new ClaudeComputerAgent({ task, model, apiKey })

      const sessionId = uuidV4()
      const guard = new Guard()
      liveness.start(sessionId, guard)
      try {
        const result = await runComputerSession({
          sessionId,
          task,
          target,
          agent,
          guard,
          maxSteps:
            s.computerUse.maxSteps ?? SETTING_DEFAULTS.computerUse.maxSteps,
          settleMs:
            s.computerUse.settleMs ?? SETTING_DEFAULTS.computerUse.settleMs,
          askHumanTimeoutMs: s.computerUse.askHumanTimeoutMs ?? 300_000,
          // Re-checked against the *resolved* window inside the session — the
          // exact match above only gates the model's `target` string.
          allowlist,
          signal,
          // Stamp `sessionId` onto every frame — `SessionUpdate` itself omits
          // it, and the chat panel needs it to POST an `askHuman` answer while
          // the session is still running (before the final result arrives).
          onUpdate: (u) => {
            const frame = { ...u, sessionId }
            // The card reads `thumbnail` from `details`; keeping it in the text
            // block too doubled the SSE payload on every acting step.
            const text = JSON.stringify(
              frame.thumbnail ? { ...frame, thumbnail: undefined } : frame
            )
            onUpdate?.({
              content: [{ type: 'text' as const, text }],
              details: frame
            })
          }
        })

        return {
          content: [
            { type: 'text' as const, text: result.summary },
            ...(result.finalScreenshot
              ? [
                  {
                    type: 'image' as const,
                    data: result.finalScreenshot.data,
                    mimeType: 'image/png' as const
                  }
                ]
              : [])
          ],
          details: {
            sessionId,
            outcome: result.outcome,
            steps: result.steps,
            summary: result.summary
          }
        }
      } finally {
        liveness.end(sessionId)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        content: [
          {
            type: 'text' as const,
            text: `Computer session failed: ${msg}`
          }
        ],
        details: { error: msg }
      }
    }
  }
}
