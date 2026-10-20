import type { Segment } from '@actovia/shared/types/chat'
import { ThinkingOrb } from 'thinking-orbs'

/**
 * Whether to show the "waiting for the assistant" spinner.
 *
 * The spinner has to bridge the gap between "message sent" and the first
 * visible assistant activity. pi-ai opens the provider stream and then often
 * sits silent for a beat (provider TTFT, reasoning ramp-up), during which it
 * still emits an empty assistant message. The old check ("is the last message
 * an assistant message?") flipped on that empty message and hid the spinner,
 * leaving a blank "did it disconnect?" gap.
 *
 * Instead, key off whether a *non-empty* assistant turn has surfaced: empty
 * turns are dropped by `groupIntoSegments`, so until real content — a thinking
 * step, a tool call, or streamed text — lands, the last segment is still the
 * user message and the spinner stays up. The moment progress appears, the
 * assistant turn renders its own timeline and the spinner goes away.
 *
 * A regenerate group ends the list with its own segment, new answer or not:
 * the column the answer will arrive in does the waiting there.
 */
export function shouldShowMessageSpinner(
  segments: Segment[],
  isLoading: boolean
): boolean {
  if (!isLoading) return false
  const last = segments.at(-1)
  return last === undefined || last.type === 'user'
}

/**
 * The orb of the thinking timeline, at work — where the timeline's own orb
 * will be once the run shows its first step, so waiting and thinking are one
 * figure that stays put rather than dots that give way to something else.
 * Same box as the timeline's header (`mb-3`, a 20px row).
 */
export function MessageSpinner() {
  return (
    <div
      className="mb-3 flex h-5 items-center"
      role="status"
      aria-live="polite"
    >
      <ThinkingOrb state="working" size={20} className="shrink-0" />
    </div>
  )
}
