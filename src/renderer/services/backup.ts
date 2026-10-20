import { fetcher } from '@actovia/shared/utils/http'

export interface BackupInfo {
  name: string
  size: number
  createdAt: string
}

export interface BackupStatus {
  autoBackup: boolean
  lastBackupAt: string | null
}

export const listBackups = () => fetcher<BackupInfo[]>('/api/v1/backup/list')

export const getBackupStatus = () =>
  fetcher<BackupStatus>('/api/v1/backup/status')

export const createBackupNow = () =>
  fetcher<{ filePath: string }>('/api/v1/backup/now', { method: 'POST' })
