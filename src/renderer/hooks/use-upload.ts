import { useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toast } from '@/components/ui/toast'
import { prepareImageFile } from '@/lib/prepare-image'
import { convertFileToBase64 } from '@/lib/utils'
import { attachmentAtom } from '@/stores/chat'

export function useUpload() {
  const { t } = useTranslation('chat')
  const [loading, setLoading] = useState(false)
  const setAttachments = useSetAtom(attachmentAtom)

  const uploadFileToBase64 = async (files: File[]) => {
    const results = await Promise.all(
      files.map(async (original) => {
        const file = await prepareImageFile(original)
        const base64 = await convertFileToBase64(file)
        return { name: file.name, url: base64, contentType: file.type }
      })
    )
    setAttachments((prev) => [...(prev ?? []), ...results])
  }

  const uploadFile = async (files: File[], cleanup?: () => void) => {
    try {
      setLoading(true)
      await uploadFileToBase64(files)
    } catch {
      toast.add({
        type: 'error',
        title: t('upload.failedTitle'),
        description: t('upload.failedDescription')
      })
    } finally {
      setLoading(false)
      if (typeof cleanup === 'function') {
        cleanup()
      }
    }
  }

  return { loading, uploadFile }
}
