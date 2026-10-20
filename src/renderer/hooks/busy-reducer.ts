// src/renderer/hooks/busy-reducer.ts
//
// Pure reducer that turns the Philharmonic SSE stream into "who is doing what
// right now". Kept separate from the React hook so it can be tested without
// pulling in EventSource or any DOM globals.

import type {
  ConversationMessageRole,
  PhilharmonicSseEvent
} from '@actovia/shared/types/philharmonic'

/** Sentinel key used for the PM in the busyAgents map. The members panel
 * already uses this convention internally. */
export const PM_KEY = '__pm__'

export interface BusyState {
  /** actor → activity label. Presence means "busy". */
  busyAgents: Map<string, string>
  /** messageId → actor, used to attribute tool_card events back to a person. */
  messageActor: Map<string, string>
}

export function emptyBusyState(): BusyState {
  return { busyAgents: new Map(), messageActor: new Map() }
}

/**
 * Apply one SSE event and return the next state. Always returns a new object
 * (and new Maps) so React state updates compare unequal. Events we don't care
 * about pass through unchanged.
 */
export function reduceBusy(
  state: BusyState,
  evt: PhilharmonicSseEvent
): BusyState {
  switch (evt.type) {
    case 'pm_started': {
      const busy = new Map(state.busyAgents)
      busy.set(PM_KEY, 'orchestrating…')
      return { busyAgents: busy, messageActor: state.messageActor }
    }
    case 'pm_ended': {
      if (!state.busyAgents.has(PM_KEY)) return state
      const busy = new Map(state.busyAgents)
      busy.delete(PM_KEY)
      return { busyAgents: busy, messageActor: state.messageActor }
    }
    case 'message_start': {
      const actor = actorForRole(evt.role, evt.agentId)
      if (!actor) return state
      const ma = new Map(state.messageActor)
      ma.set(evt.messageId, actor)
      const busy = new Map(state.busyAgents)
      busy.set(actor, defaultActivityFor(evt.role))
      return { busyAgents: busy, messageActor: ma }
    }
    case 'message_end': {
      const actor = state.messageActor.get(evt.messageId)
      if (!actor) return state
      const ma = new Map(state.messageActor)
      ma.delete(evt.messageId)
      const busy = new Map(state.busyAgents)
      // Only drop the actor's busy slot if no other in-flight message holds them.
      const stillBusy = anyOtherInFlight(ma, actor)
      if (!stillBusy && actor !== PM_KEY) busy.delete(actor)
      // PM busy slot stays until pm_ended; the LLM may send several message
      // chunks in one turn and we don't want the panel flickering.
      return { busyAgents: busy, messageActor: ma }
    }
    case 'tool_card': {
      const actor = state.messageActor.get(evt.messageId)
      if (!actor) return state
      const busy = new Map(state.busyAgents)
      if (evt.phase === 'start') {
        busy.set(actor, `running ${evt.toolName}…`)
      } else {
        // Tool returned — flip back to the default activity for this actor.
        const role: ConversationMessageRole =
          actor === PM_KEY ? 'pm' : 'employee'
        busy.set(actor, defaultActivityFor(role))
      }
      return { busyAgents: busy, messageActor: state.messageActor }
    }
    case 'conversation_error': {
      // Errored turn — clear everything so the panel doesn't lie.
      if (state.busyAgents.size === 0 && state.messageActor.size === 0) {
        return state
      }
      return emptyBusyState()
    }
    default:
      return state
  }
}

function actorForRole(
  role: ConversationMessageRole,
  agentId?: string
): string | null {
  if (role === 'pm') return PM_KEY
  if (role === 'employee') return agentId ?? null
  // user / system messages don't make anyone busy
  return null
}

function defaultActivityFor(role: ConversationMessageRole): string {
  return role === 'pm' ? 'orchestrating…' : 'thinking…'
}

function anyOtherInFlight(ma: Map<string, string>, actor: string): boolean {
  for (const v of ma.values()) {
    if (v === actor) return true
  }
  return false
}
