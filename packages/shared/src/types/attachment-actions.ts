/**
 * Saving and copying an attachment shown in the chat (a sent image, a
 * generated one, a search result's picture). The renderer names *what* —
 * the attachment's own URL and file name — and the main process does the
 * rest: the native save dialog (the user picks the path, never the page),
 * the native context menu, the clipboard. See `src/main/lib/attachment-actions.ts`.
 */
export const ATTACHMENT_CHANNELS = {
  /** `AttachmentRequest` → `AttachmentResult`: the save dialog, then the write. */
  save: 'attachment:save',
  /** `AttachmentRequest` → `AttachmentResult`: the image onto the clipboard. */
  copyImage: 'attachment:copy-image',
  /** `AttachmentRequest` → `AttachmentResult`: the native right-click menu. */
  contextMenu: 'attachment:context-menu'
} as const

export type AttachmentKind = 'image' | 'file'

export interface AttachmentRequest {
  /**
   * Where the bytes are: a base64 `data:` URL (a sent image), Actovia's own
   * media route (a generated image), or an `https:` image (a search result).
   */
  url: string
  /** The original file name, when there is one; main derives one otherwise. */
  name?: string
  kind: AttachmentKind
}

export type AttachmentResult =
  | { status: 'saved'; name: string }
  | { status: 'copied' }
  | { status: 'cancelled' }
  | {
      status: 'failed'
      reason: AttachmentFailure
      /** Which of the two it was, once one was chosen. */
      action?: 'save' | 'copy'
    }

export type AttachmentFailure =
  | 'invalid-request'
  | 'unavailable'
  | 'too-large'
  | 'unsupported-image'
  | 'write-failed'
