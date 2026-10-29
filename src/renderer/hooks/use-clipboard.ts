import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toast } from '@/components/ui/toast'

export function useClipboard() {
  const { t } = useTranslation('common')
  const [copied, setCopied] = useState('')

  /** Resolves to whether the text is on the clipboard; a failure is toasted here. */
  const handleCopy = async (text: string): Promise<boolean> => {
    try {
      await window.navigator.clipboard.writeText(text)
      setCopied(text)
      setTimeout(() => {
        setCopied('')
      }, 2000)
      return true
    } catch (error) {
      toast.add({
        type: 'error',
        title: t('clipboard.failedTitle'),
        description:
          error instanceof Error ? error.message : t('clipboard.genericError')
      })
      return false
    }
  }

  return { copied, handleCopy }
}
