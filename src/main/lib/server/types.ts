import type { Context } from 'hono'

import type { Settings } from '../db/schema'

export type ListenerKind = 'loopback' | 'lan'

/** @hono/node-server's bindings, plus which of our two listeners took the request. */
export interface Bindings {
  listener?: ListenerKind
  incoming?: { socket?: { remoteAddress?: string } }
}

export interface Variables {
  settings: Settings
  /** Internally scheduled chat: nobody is present to approve a tool call. */
  scheduled?: boolean
  /** Set by authGate for a request from a paired device. */
  deviceId?: string
}

/** `app.request()` in unit tests passes no bindings: that is the loopback case. */
export function listenerOf(c: Context): ListenerKind {
  return (c.env as Bindings | undefined)?.listener ?? 'loopback'
}
