// src/renderer/hooks/use-philharmonic-upload.ts
import type { Attachment } from '@actovia/shared/types/chat'
import { useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toast } from '@/components/ui/toast'
import { prepareImageFile } from '@/lib/prepare-image'
import { convertFileToBase64 } from '@/lib/utils'
import { philharmonicAttachmentAtom } from '@/stores/philharmonic'

async function toAttachment(file: File): Promise<Attachment> {
  return {
    name: file.name,
    url: await convertFileToBase64(file),
    contentType: file.type
  }
}

/**
 * Photos for the Philharmonic composer, as Chat attaches them: each one
 * prepared (`prepareImageFile`) and embedded as a data URL. The server fits
 * whatever still needs it before the row is saved. (An S3 path used to sit
 * here: it posted to a route that does not exist, and an S3 link would have
 * reached the model as if it were image data.)
 */
export function usePhilharmonicUpload() {
  const { t } = useTranslation('philharmonic')
  const [uploading, setUploading] = useState(false)
  const setAttachments = useSetAtom(philharmonicAttachmentAtom)

  const upload = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    setUploading(true)
    try {
      const results = await Promise.all(
        files.map(async (file) => toAttachment(await prepareImageFile(file)))
      )
      setAttachments((prev) => [...prev, ...results])
    } catch (err) {
      toast.add({
        type: 'error',
        title: t('chat.uploader.attachFailedTitle'),
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setUploading(false)
    }
  }

  return { uploading, upload }
}
