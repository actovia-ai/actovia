export type AbortReason = 'hotkey' | 'user' | 'system'

/** Cancellation shared by the upstream CLI calls and Actovia's stop switch. */
export class Guard {
  private readonly controller = new AbortController()
  get aborted(): boolean {
    return this.controller.signal.aborted
  }
  get signal(): AbortSignal {
    return this.controller.signal
  }
  abort(reason: AbortReason): void {
    if (!this.aborted) this.controller.abort(reason)
  }
}
