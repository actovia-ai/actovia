import { DEVICE_NAME_MAX_LENGTH } from '@actovia/shared/constants/systems'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function DeviceRename({
  name,
  onRename
}: {
  name: string
  onRename: (name: string) => Promise<unknown>
}) {
  const { t } = useTranslation('settings')
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(name)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const trimmed = draft.trim()
  const canSave =
    !saving &&
    trimmed !== name &&
    trimmed.length > 0 &&
    trimmed.length <= DEVICE_NAME_MAX_LENGTH

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={TEST_IDS.devices.renameButton}
        onClick={() => {
          setDraft(name)
          setSaveFailed(false)
          dialog.current?.showModal()
          input.current?.select()
        }}
      >
        {t('devices.row.rename')}
      </Button>
      {/* Settings already has a form. Mount this one outside it. */}
      {createPortal(
        <dialog
          ref={dialog}
          aria-labelledby={`${id}-title`}
          className="bg-popover text-popover-foreground ring-foreground/10 fixed inset-0 m-auto w-[min(calc(100%-2rem),24rem)] overscroll-contain rounded-xl p-4 text-sm ring-1 backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-black/20"
          onCancel={(event) => {
            if (saving) event.preventDefault()
          }}
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={async (event) => {
              event.preventDefault()
              event.stopPropagation()
              if (!canSave) return
              setSaving(true)
              setSaveFailed(false)
              try {
                await onRename(trimmed)
                dialog.current?.close()
              } catch {
                setSaveFailed(true)
                input.current?.focus()
              } finally {
                setSaving(false)
              }
            }}
          >
            <h2 id={`${id}-title`} className="text-base font-medium">
              {t('devices.renameDialog.title')}
            </h2>
            <div className="flex flex-col gap-2">
              <label htmlFor={id}>{t('devices.renameDialog.name')}</label>
              <Input
                id={id}
                ref={input}
                value={draft}
                required
                readOnly={saving}
                maxLength={DEVICE_NAME_MAX_LENGTH}
                onChange={(event) => setDraft(event.target.value)}
              />
            </div>
            {saveFailed && (
              <p className="text-destructive" role="alert">
                {t('devices.toast.failedTitle')}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => dialog.current?.close()}
              >
                {t('devices.pairing.cancel')}
              </Button>
              <Button type="submit" disabled={!canSave}>
                {t('devices.renameDialog.confirm')}
              </Button>
            </div>
          </form>
        </dialog>,
        document.body
      )}
    </>
  )
}
