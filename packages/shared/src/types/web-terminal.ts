/** Persisted on the host; the authenticator's private key never leaves it. */
export interface WebTerminalCredential {
  id: string
  publicKey: string
  counter: number
  transports?: string[]
}

export interface WebAccessConfig {
  enabled: boolean
  origin: string
}

export interface WebTerminalStatus {
  paired: boolean
  unlocked: boolean
  deviceName?: string
}

export const WEB_CLIENT_HEADER = 'x-actovia-web'
export const WEB_SESSION_EVENT = 'actovia:web-session-required'
