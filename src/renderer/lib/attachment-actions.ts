import {
  ATTACHMENT_CHANNELS,
  type AttachmentRequest,
  type AttachmentResult
} from '@actovia/shared/types/attachment-actions'
import type { TFunction } from 'i18next'

import { toast } from '@/components/ui/toast'

/** The `common` namespace's `t` (a hook's; this module stays hook-free). */
export type CommonT = TFunction<'common'>

/**
 * Save / Copy for an attachment in the chat, done by the main process
 * (`src/main/lib/attachment-actions.ts`): the page names the attachment, main
 * shows the native save dialog or context menu and writes only where the
 * user chose.
 */

function invoke(
  channel: string,
  request: AttachmentRequest
): Promise<AttachmentResult> {
  return window.electron.ipcRenderer
    .invoke(channel, request)
    .then((result) => result as AttachmentResult)
    .catch(() => ({ status: 'failed', reason: 'write-failed' }) as const)
}

/** What came of it, said only when there is something to say. */
export function reportAttachmentResult(
  result: AttachmentResult,
  t: CommonT
): void {
  if (result.status === 'copied') {
    toast.add({ type: 'success', title: t('attachment.copied') })
  } else if (result.status === 'failed') {
    toast.add({
      type: 'error',
      title:
        result.action === 'copy'
          ? t('attachment.copyFailed')
          : t('attachment.saveFailed')
    })
  }
}

/** The native save dialog, then the write. */
export async function saveAttachment(
  request: AttachmentRequest,
  t: CommonT
): Promise<AttachmentResult> {
  const result = await invoke(ATTACHMENT_CHANNELS.save, request)
  reportAttachmentResult(result, t)
  return result
}

/** The native right-click menu: Save Image As… / Copy Image, or Save As…. */
export async function openAttachmentMenu(
  request: AttachmentRequest,
  t: CommonT
): Promise<AttachmentResult> {
  const result = await invoke(ATTACHMENT_CHANNELS.contextMenu, request)
  reportAttachmentResult(result, t)
  return result
}
