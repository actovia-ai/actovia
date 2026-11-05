import { randomBytes } from 'node:crypto'

import type { WebTerminalCredential } from '@actovia/shared/types/web-terminal'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON
} from '@simplewebauthn/server'

import { createPairing, randomPairingCode } from '../lan/pairing'
import { createWebSessions } from './sessions'

export interface TerminalDevice {
  id: string
  name: string
  webCredential: WebTerminalCredential | null
}

interface Pending {
  challenge: string
  origin: string
  expiresAt: number
  generation: number
  deviceId?: string
  name?: string
}

export function createWebTerminals(deps: {
  authenticate(binding: string): Promise<string | null>
  find(id: string): Promise<TerminalDevice | null>
  register(
    name: string,
    credential: WebTerminalCredential
  ): Promise<{ deviceId: string; token: string }>
  update(id: string, credential: WebTerminalCredential): Promise<void>
  remove(id: string): Promise<void>
  unlockHost(): void
  now?: () => number
}) {
  const now = deps.now ?? Date.now
  const pairing = createPairing({ now, randomCode: randomPairingCode })
  const sessions = createWebSessions(now)
  const pending = new Map<string, Pending>()
  let generation = 0
  const verifying = new Set<string>()

  function remember(value: Omit<Pending, 'generation' | 'expiresAt'>) {
    for (const [id, item] of pending)
      if (
        item.expiresAt <= now() ||
        (value.deviceId && item.deviceId === value.deviceId)
      )
        pending.delete(id)
    // Even authenticated callers cannot grow the challenge store unboundedly.
    if (pending.size >= 100) throw new Error('Too many pending verifications.')
    const id = randomBytes(32).toString('base64url')
    pending.set(id, { ...value, generation, expiresAt: now() + 120_000 })
    return id
  }

  function take(id: string, origin: string, deviceId?: string) {
    const value = pending.get(id)
    pending.delete(id)
    if (
      !value ||
      value.expiresAt <= now() ||
      value.generation !== generation ||
      value.origin !== origin ||
      value.deviceId !== deviceId
    )
      throw new Error('Verification expired.')
    return value
  }

  function current(item: Pending) {
    if (item.generation !== generation || item.expiresAt <= now())
      throw new Error('Verification expired.')
  }

  async function device(binding: string) {
    const id = await deps.authenticate(binding)
    return id ? deps.find(id) : null
  }

  return {
    pairing: {
      current: pairing.current,
      open() {
        generation++
        pending.clear()
        return pairing.open()
      },
      close() {
        generation++
        pending.clear()
        pairing.close()
      }
    },
    sessions,
    device,
    async forget(id: string) {
      sessions.revoke(id)
      await deps.remove(id)
    },
    invalidate(id?: string) {
      sessions.revoke(id)
      if (!id) {
        generation++
        pairing.close()
        pending.clear()
      } else {
        for (const [key, value] of pending)
          if (value.deviceId === id) pending.delete(key)
      }
    },
    async registrationOptions(code: string, name: string, origin: string) {
      const startedAtGeneration = generation
      if (pairing.verify(code) !== 'ok')
        throw new Error('The pairing code expired or is not valid.')
      const options = await generateRegistrationOptions({
        rpName: 'Actovia',
        rpID: new URL(origin).hostname,
        userName: name,
        userDisplayName: name,
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'required'
        },
        supportedAlgorithmIDs: [-7, -257],
        timeout: 120_000
      })
      if (generation !== startedAtGeneration)
        throw new Error('Verification expired.')
      const requestId = remember({ challenge: options.challenge, origin, name })
      return { requestId, options }
    },
    async finishRegistration(
      requestId: string,
      response: RegistrationResponseJSON,
      origin: string
    ) {
      const item = take(requestId, origin)
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge: item.challenge,
        expectedOrigin: origin,
        expectedRPID: new URL(origin).hostname,
        requireUserVerification: true
      })
      current(item)
      if (!result.verified) throw new Error('Verification failed.')
      const credential = result.registrationInfo.credential
      const registered = await deps.register(item.name!, {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: credential.transports
      })
      if (item.generation !== generation || item.expiresAt <= now()) {
        await deps.remove(registered.deviceId)
        throw new Error('Verification expired.')
      }
      return {
        ...registered,
        session: sessions.create(registered.deviceId, registered.token)
      }
    },
    async authenticationOptions(binding: string, origin: string) {
      const startedAtGeneration = generation
      const found = await device(binding)
      if (!found?.webCredential) throw new Error('Pair this browser again.')
      if (verifying.has(found.id))
        throw new Error('Verification is already in progress.')
      const options = await generateAuthenticationOptions({
        rpID: new URL(origin).hostname,
        allowCredentials: [
          {
            id: found.webCredential.id,
            transports: found.webCredential.transports
          }
        ],
        userVerification: 'required',
        timeout: 120_000
      })
      if (
        verifying.has(found.id) ||
        generation !== startedAtGeneration ||
        (await deps.authenticate(binding)) !== found.id
      )
        throw new Error('Verification expired.')
      return {
        requestId: remember({
          challenge: options.challenge,
          origin,
          deviceId: found.id
        }),
        options
      }
    },
    async finishAuthentication(
      binding: string,
      requestId: string,
      response: AuthenticationResponseJSON,
      origin: string
    ) {
      const found = await device(binding)
      if (!found?.webCredential) throw new Error('Pair this browser again.')
      if (verifying.has(found.id))
        throw new Error('Verification is already in progress.')
      const item = take(requestId, origin, found.id)
      verifying.add(found.id)
      try {
        const credential = found.webCredential
        const result = await verifyAuthenticationResponse({
          response,
          expectedChallenge: item.challenge,
          expectedOrigin: origin,
          expectedRPID: new URL(origin).hostname,
          requireUserVerification: true,
          credential: {
            id: credential.id,
            publicKey: new Uint8Array(
              Buffer.from(credential.publicKey, 'base64url')
            ),
            counter: credential.counter,
            transports: credential.transports
          }
        })
        current(item)
        if (!result.verified || (await deps.authenticate(binding)) !== found.id)
          throw new Error('Verification failed.')
        await deps.update(found.id, {
          ...credential,
          counter: result.authenticationInfo.newCounter
        })
        current(item)
        if ((await deps.authenticate(binding)) !== found.id)
          throw new Error('Device revoked.')
        current(item)
        deps.unlockHost()
        return sessions.create(found.id, binding)
      } finally {
        verifying.delete(found.id)
      }
    }
  }
}
