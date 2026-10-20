import type { LockStatus } from '@actovia/shared/types/lock'
import { atom } from 'jotai'

export const lockStatusAtom = atom<LockStatus | null>(null)
