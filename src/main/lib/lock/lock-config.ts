import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

import {
  DEFAULT_LOCK_CONFIG,
  type LockConfig
} from '@actovia/shared/types/lock'

import { logger } from '../logger'
import { getLockConfigPath } from '../paths'

export function readConfig(): LockConfig {
  const path = getLockConfigPath()
  if (!existsSync(path)) return { ...DEFAULT_LOCK_CONFIG }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockConfig>
    return { ...DEFAULT_LOCK_CONFIG, ...parsed }
  } catch (err) {
    logger.warn('app', 'Failed to read lock config, using defaults', {
      error: err
    })
    return { ...DEFAULT_LOCK_CONFIG }
  }
}

export function writeConfig(patch: Partial<LockConfig>): LockConfig {
  const path = getLockConfigPath()
  const next = { ...readConfig(), ...patch }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf8')
  return next
}
