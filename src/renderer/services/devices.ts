import { fetcher } from '@actovia/shared/utils/http'

import { presenceHeaders } from '@/lib/presence'

export interface PairedDeviceInfo {
  id: string
  name: string
  createdAt: string
  lastSeenAt: string | null
}

export interface PairingInfo {
  /** Epoch ms. */
  expiresAt: number
  /** What the QR code encodes: `actovia://pair?h=&p=&c=&f=&n=`. */
  link: string
}

/** Revoked here; the device has not come back to learn it yet. */
export interface RevokedDeviceInfo {
  name: string | null
  revokedAt: string
}

export interface DevicesState {
  devices: PairedDeviceInfo[]
  pairing: PairingInfo | null
  lanRunning: boolean
  /** Absent from an Actovia older than the list. */
  revoked?: RevokedDeviceInfo[]
  /**
   * `unreadable`: the certificate's key does not decrypt on this Mac, so no
   * device can connect until Reset all. Absent from an older Actovia.
   */
  certificate?: 'ok' | 'unreadable'
}

export const DEVICES_URL = '/api/v1/devices'

// Every devices request carries the window's presence token: the API refuses
// this prefix to any other local process (a pairing code must not reach a
// `curl` the model runs).
const withPresence = async <T>(
  url: string,
  options: { method?: 'GET' | 'POST' | 'DELETE' } = {}
) => fetcher<T>(url, { ...options, headers: await presenceHeaders() })

export const getDevices = () => withPresence<DevicesState>(DEVICES_URL)

export const openPairing = () =>
  withPresence<PairingInfo>(`${DEVICES_URL}/pairing`, { method: 'POST' })

export const cancelPairing = () =>
  withPresence(`${DEVICES_URL}/pairing`, { method: 'DELETE' })

export const revokeDevice = (id: string) =>
  withPresence(`${DEVICES_URL}/${id}`, { method: 'DELETE' })

export const resetDevices = () =>
  withPresence(`${DEVICES_URL}/reset`, { method: 'POST' })
