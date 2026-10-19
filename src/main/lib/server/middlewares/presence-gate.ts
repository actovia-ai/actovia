import type { Context, Next } from 'hono'

import { isPresenceToken, PRESENCE_HEADER } from '../../presence'
import { listenerOf } from '../types'

/**
 * Routes that act for the user in person: answering a tool-approval prompt
 * and managing paired devices. Anything on loopback can reach the API — that
 * includes a `curl` the model runs with the `terminal` tool, which could
 * otherwise approve its own paused call, or open a pairing window, read its
 * code and pair itself a device that approves over the LAN. So on loopback
 * these need the presence token only Exodus's own window holds (IPC, see
 * `presence.ts`); on the LAN listener `authGate` has already required a
 * paired device's token, which is what the user in person holds there.
 */
export const PRESENCE_PATHS = ['/api/v1/chat/approval', '/api/v1/devices']

export function needsPresence(path: string): boolean {
  return PRESENCE_PATHS.some((p) => path === p || path.startsWith(`${p}/`))
}

/**
 * CLI employees (Claude Code, Codex): answering a permission prompt,
 * interrupting, Continue in Terminal, folder changes, a CLI check — everything
 * but a read stands for the owner in person (a `curl` from the CLI's own shell
 * tool could otherwise approve its own prompt). The renderer sends `presenceHeaders()`.
 */
const WRITE_PREFIXES = [
  '/api/v1/agents',
  '/api/v1/projects',
  // Employee edits (runtime, permission mode): a model must not loosen its own.
  '/api/v1/philharmonic/agents',
  // A scheduled task's run is a PM run (scheduler.ts), and a team's prompt
  // reaches its members: both reach the PM as surely as a group message.
  '/api/v1/philharmonic/tasks',
  '/api/v1/philharmonic/teams'
]
/**
 * A group message and an answer to the PM's question: a local process
 * posting either could get the PM to hand an `auto` coding agent work.
 */
const GROUP_POSTS =
  /^\/api\/v1\/philharmonic\/conversations\/[^/]+\/(?:messages|respond)\/?$/u
/** Deleting a group deletes its scheduled tasks with it. */
const GROUP_ROW = /^\/api\/v1\/philharmonic\/conversations\/[^/]+\/?$/u
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function needsPresenceFor(path: string, method: string): boolean {
  if (needsPresence(path)) return true
  if (SAFE_METHODS.has(method.toUpperCase())) return false
  if (GROUP_POSTS.test(path)) return true
  if (method.toUpperCase() === 'DELETE' && GROUP_ROW.test(path)) return true
  return WRITE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

export async function presenceGate(c: Context, next: Next) {
  if (!needsPresenceFor(c.req.path, c.req.method)) return next()
  if (listenerOf(c) === 'lan') return next()
  if (isPresenceToken(c.req.header(PRESENCE_HEADER))) return next()
  return c.json(
    {
      type: 'error',
      error: {
        code: 'PRESENCE_REQUIRED',
        message: 'Only the Actovia window can do this.'
      }
    },
    403
  )
}
