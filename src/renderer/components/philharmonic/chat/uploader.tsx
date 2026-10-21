import { Loading03Icon, Add01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { type ChangeEvent, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { usePhilharmonicUpload } from '@/hooks/use-philharmonic-upload'

export function ComposerUploader() {
  const { t } = useTranslation('philharmonic')
  const { upload, uploading } = usePhilharmonicUpload()
  const inputRef = useRef<HTMLInputElement>(null)

  const onChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    await upload([...files])
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t('chat.uploader.attachAria')}
      disabled={uploading}
      className="text-muted-foreground hover:bg-muted hover:text-foreground relative size-8 shrink-0 rounded-full [&_svg]:size-[18px]"
    >
      {uploading ? (
        <HugeiconsIcon
          icon={Loading03Icon}

          className="animate-spin"
        />
      ) : (
        <HugeiconsIcon icon={Add01Icon} />
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={onChange}
        disabled={uploading}
        tabIndex={-1}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        aria-hidden="true"
      />
    </Button>
  )
}
