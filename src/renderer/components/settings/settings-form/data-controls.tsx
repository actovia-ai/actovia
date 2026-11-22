import {
  Archive02Icon,
  Loading03Icon,
  Delete02Icon,
  HardDriveDownloadIcon,
  HardDriveUploadIcon,
  ShieldCheckIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  useBackupList,
  useBackupStatus,
  useCreateBackup
} from '@/hooks/use-backup'
import { useDbIo } from '@/hooks/use-db-io'
import { useSettings } from '@/hooks/use-settings'
import { cn } from '@/lib/utils'

import { ENTER_UP, staggerDelay } from '../settings-kit'
import { SettingsRow, SettingsSection } from '../settings-row'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function DataControls() {
  const { t } = useTranslation(['common', 'settings'])
  const { data: settings, updateSettings } = useSettings()
  const { data: backupStatus } = useBackupStatus()
  const { data: backups } = useBackupList()
  const createBackup = useCreateBackup()

  const {
    exportData,
    importData,
    deleteData,
    exportLoading,
    importLoading,
    deleteLoading
  } = useDbIo()

  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const handleToggleAutoBackup = async (enabled: boolean) => {
    if (!settings) return
    await updateSettings({ ...settings, autoBackup: enabled })
  }

  const handleImportConfirm = async () => {
    if (!selectedFile) return
    if (!(await importData(selectedFile))) return
    setImportDialogOpen(false)
    setSelectedFile(null)
  }

  const handleDeleteConfirm = async () => {
    if (deleteConfirmText !== 'DELETE') return
    await deleteData()
    setDeleteDialogOpen(false)
    setDeleteConfirmText('')
  }

  return (
    <>
      <SettingsSection title={t('settings:dataControls.sections.backups')}>
        {/* Automatic Backups */}
        <SettingsRow
          label={t('settings:dataControls.autoBackup.label')}
          description={t('settings:dataControls.autoBackup.description')}
        >
          <Switch
            checked={settings?.autoBackup ?? true}
            onCheckedChange={handleToggleAutoBackup}
          />
        </SettingsRow>

        <SettingsRow
          label={t('settings:dataControls.lastBackup.label')}
          description={
            backupStatus?.lastBackupAt
              ? formatDate(backupStatus.lastBackupAt)
              : t('settings:dataControls.lastBackup.none')
          }
        >
          <Button
            variant="outline"
            size="sm"
            disabled={createBackup.isPending}
            onClick={() => createBackup.mutate()}
          >
            {createBackup.isPending ? (
              <HugeiconsIcon
                icon={Loading03Icon}

                className="animate-spin"
              />
            ) : (
              <HugeiconsIcon icon={ShieldCheckIcon} />
            )}
            {t('settings:dataControls.backupNow.button')}
          </Button>
        </SettingsRow>

        {/* Show recent backups */}
        {backups && backups.length > 0 && (
          <SettingsRow
            label={t('settings:dataControls.recentBackups.label')}
            description={t('settings:dataControls.recentBackups.description', {
              count: backups.length
            })}
            layout="vertical"
          >
            <ul className="text-muted-foreground mt-1 flex flex-col gap-1.5 text-xs">
              {backups.slice(0, 5).map((b, index) => (
                <li
                  key={b.name}
                  className={cn('flex items-center justify-between', ENTER_UP)}
                  style={staggerDelay(index)}
                >
                  <span className="flex items-center gap-2">
                    <HugeiconsIcon
                      icon={Archive02Icon}

                      className="size-3.5"
                    />
                    {b.name}
                  </span>
                  <span className="tabular-nums">{formatBytes(b.size)}</span>
                </li>
              ))}
            </ul>
          </SettingsRow>
        )}
      </SettingsSection>

      <SettingsSection title={t('settings:dataControls.sections.transfer')}>
        {/* Export */}
        <SettingsRow
          label={t('settings:dataControls.export.label')}
          description={t('settings:dataControls.export.description')}
        >
          <Button
            variant="outline"
            disabled={exportLoading}
            onClick={exportData}
          >
            {exportLoading ? (
              <HugeiconsIcon
                icon={Loading03Icon}

                className="animate-spin"
              />
            ) : (
              <HugeiconsIcon icon={HardDriveDownloadIcon} />
            )}
            {t('settings:dataControls.export.button')}
          </Button>
        </SettingsRow>

        {/* Import */}
        <SettingsRow
          label={t('settings:dataControls.import.label')}
          description={t('settings:dataControls.import.description')}
        >
          <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
            <DialogTrigger
              render={
                <Button variant="outline" disabled={importLoading}>
                  {importLoading ? (
                    <HugeiconsIcon
                      icon={Loading03Icon}

                      className="animate-spin"
                    />
                  ) : (
                    <HugeiconsIcon icon={HardDriveUploadIcon} />
                  )}
                  {t('settings:dataControls.import.button')}
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {t('settings:dataControls.import.label')}
                </DialogTitle>
                <DialogDescription>
                  {t('settings:dataControls.import.dialogDescription')}
                </DialogDescription>
              </DialogHeader>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              />
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setImportDialogOpen(false)}
                >
                  {t('action.cancel')}
                </Button>
                <Button
                  disabled={!selectedFile || importLoading}
                  onClick={handleImportConfirm}
                >
                  {importLoading && (
                    <HugeiconsIcon
                      icon={Loading03Icon}

                      className="animate-spin"
                    />
                  )}
                  {t('settings:dataControls.import.confirmButton')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </SettingsRow>
      </SettingsSection>

      {/* Destructive, so on its own and last — never beside Export/Import. */}
      <SettingsSection title={t('settings:dataControls.sections.danger')}>
        {/* Delete */}
        <SettingsRow
          label={t('settings:dataControls.delete.label')}
          description={t('settings:dataControls.delete.description')}
        >
          <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <DialogTrigger
              render={
                <Button variant="destructive" disabled={deleteLoading}>
                  {deleteLoading ? (
                    <HugeiconsIcon
                      icon={Loading03Icon}

                      className="animate-spin"
                    />
                  ) : (
                    <HugeiconsIcon icon={Delete02Icon} />
                  )}
                  {t('settings:dataControls.delete.label')}
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {t('settings:dataControls.delete.label')}
                </DialogTitle>
                <DialogDescription>
                  {t('settings:dataControls.delete.dialogDescription')}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <p className="text-sm">
                  <Trans
                    ns="settings"
                    i18nKey="dataControls.delete.confirmPrompt"
                  >
                    Type <strong>DELETE</strong> to confirm:
                  </Trans>
                </p>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeleteDialogOpen(false)
                    setDeleteConfirmText('')
                  }}
                >
                  {t('action.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  disabled={deleteConfirmText !== 'DELETE' || deleteLoading}
                  onClick={handleDeleteConfirm}
                >
                  {deleteLoading && (
                    <HugeiconsIcon
                      icon={Loading03Icon}

                      className="animate-spin"
                    />
                  )}
                  {t('settings:dataControls.delete.confirmButton')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </SettingsRow>
      </SettingsSection>
    </>
  )
}
