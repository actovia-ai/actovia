import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { homedir, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import tls from 'node:tls'

import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'

interface Reply {
  status: number
  body: string
}

const LAN_PORT = 63129

/**
 * A TLS connection whose peer has been checked against the pin — resolved only
 * after the check, so nothing (least of all a bearer token) is ever written to
 * an unverified peer. `rejectUnauthorized: false` is not "skip verification"
 * here: the certificate is self-signed by design, so there is no CA to verify
 * against, and the fingerprint comparison below *is* the verification. This is
 * the order actovia-ios gets for free from URLSession's challenge callback.
 */
function pinnedSocket(pin: string) {
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    // codeql[js/disabling-certificate-validation]: intentional — pinning below is the real check.
    const socket = tls.connect(
      { host: '127.0.0.1', port: LAN_PORT, rejectUnauthorized: false },
      () => {
        const seen = createHash('sha256')
          .update(socket.getPeerCertificate().raw)
          .digest('base64url')
        if (seen === pin) return resolve(socket)
        socket.destroy()
        reject(new Error('certificate does not match the pairing link'))
      }
    )
    socket.once('error', reject)
  })
}

/** What actovia-ios does: trust the pinned certificate, and nothing else. */
async function pinned(
  pin: string,
  path: string,
  init: { method?: string; token?: string; json?: unknown } = {}
) {
  const socket = await pinnedSocket(pin)
  return new Promise<Reply>((resolve, reject) => {
    const body = init.json === undefined ? undefined : JSON.stringify(init.json)
    // Plain http.request over the already-verified TLS socket.
    const req = http.request(
      {
        createConnection: () => socket,
        host: '127.0.0.1',
        port: LAN_PORT,
        path,
        method: init.method ?? 'GET',
        headers: {
          connection: 'close',
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(init.token ? { authorization: `Bearer ${init.token}` } : {})
        }
      },
      (res) => {
        let text = ''
        res.on('data', (d) => (text += d))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: text })
        )
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

const canConnect = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port, timeout: 1500 })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })

/**
 * Access from the LAN (src/main/lib/lan/): nothing listens until a device is
 * paired from Settings → Devices; pairing hands out a token over a connection
 * pinned to the certificate in the QR code; revoking takes it away at once.
 */
test.describe('LAN pairing', () => {
  test('pairs a device from the Devices page, serves it, and locks it out when revoked', async ({
    mainWindow
  }) => {
    // A fresh profile has no devices, so there is no LAN listener at all.
    expect(await canConnect('127.0.0.1', LAN_PORT)).toBe(false)

    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
    await mainWindow.keyboard.press(`${modKey}+,`)
    await mainWindow
      .getByRole('button', { name: 'Devices', exact: true })
      .click()
    await expect(
      mainWindow.getByTestId(TEST_IDS.devices.resetButton)
    ).toBeVisible()
    await mainWindow.getByTestId(TEST_IDS.devices.pairButton).click()
    await expect(mainWindow.getByTestId(TEST_IDS.devices.qrCode)).toBeVisible()
    await expect(
      mainWindow.getByTestId(TEST_IDS.devices.copyLinkButton)
    ).toBeVisible()
    await expect(
      mainWindow.getByTestId(TEST_IDS.devices.cancelPairingButton)
    ).toBeVisible()

    // A loopback caller that is not the app's window (a `curl` the model
    // runs) cannot read the pairing code: /devices needs the window's own
    // presence token, which only its IPC hands out.
    expect((await fetch('http://localhost:60223/api/v1/devices')).status).toBe(
      403
    )
    const presence = (await mainWindow.evaluate(() =>
      window.electron.ipcRenderer.invoke('api:presence-token')
    )) as string

    // The link the QR code encodes, as a phone's camera would read it.
    const state = await (
      await fetch('http://localhost:60223/api/v1/devices', {
        headers: { 'x-actovia-presence': presence }
      })
    ).json()
    const link = new URL(state.pairing.link)
    const pin = link.searchParams.get('f')!
    const code = link.searchParams.get('c')!
    expect(link.protocol).toBe('actovia:')
    expect(link.searchParams.get('p')).toBe(String(LAN_PORT))

    // Unpaired: the API is shut, and a wrong code is refused.
    expect((await pinned(pin, '/api/v1/history')).status).toBe(401)
    expect(
      (
        await pinned(pin, '/api/v1/pair', {
          method: 'POST',
          json: { code: 'wrong', deviceName: 'e2e phone' }
        })
      ).status
    ).toBe(403)

    const paired = await pinned(pin, '/api/v1/pair', {
      method: 'POST',
      json: { code, deviceName: 'e2e phone' }
    })
    expect(paired.status).toBe(200)
    const { token } = JSON.parse(paired.body) as { token: string }

    expect((await pinned(pin, '/api/v1/history', { token })).status).toBe(200)
    // The code was single-use, and a device cannot manage devices.
    expect(
      (
        await pinned(pin, '/api/v1/pair', {
          method: 'POST',
          json: { code, deviceName: 'again' }
        })
      ).status
    ).toBe(404)
    expect((await pinned(pin, '/api/v1/devices', { token })).status).toBe(403)

    // The page polls while a window is open, so the new device shows up.
    const row = mainWindow
      .getByTestId(TEST_IDS.devices.deviceRow)
      .filter({ hasText: 'e2e phone' })
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.getByTestId(TEST_IDS.devices.revokeButton).click()
    await mainWindow
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Revoke', exact: true })
      .click()
    await expect(row).toHaveCount(0)

    // The revoked phone has to be told, or it stays "paired" against a
    // listener that is gone (`lan/revoked.ts`): the listener stays up for
    // it, answers its token 401 once — and only then goes, the last device
    // gone.
    expect(await canConnect('127.0.0.1', LAN_PORT)).toBe(true)
    expect((await pinned(pin, '/api/v1/history', { token })).status).toBe(401)
    await expect.poll(() => canConnect('127.0.0.1', LAN_PORT)).toBe(false)
  })

  // ISSUE-135: a key sealed by another safeStorage key (a new signature, a
  // copied data dir) is said so on the page, and Reset all brings pairing back.
  test('a certificate this Mac cannot decrypt asks for a reset', async ({
    mainWindow
  }) => {
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
    await mainWindow.keyboard.press(`${modKey}+,`)
    const devicesTab = mainWindow.getByRole('button', {
      name: 'Devices',
      exact: true
    })
    await devicesTab.click()
    // Opening a window is what makes the certificate.
    await mainWindow.getByTestId(TEST_IDS.devices.pairButton).click()
    await mainWindow.getByTestId(TEST_IDS.devices.cancelPairingButton).click()
    writeFileSync(
      join(homedir(), '.actovia', 'tls', 'key.enc'),
      Buffer.from('sealed by another keychain key')
    )

    await mainWindow
      .getByRole('button', { name: 'General', exact: true })
      .click()
    await devicesTab.click()
    await expect(
      mainWindow.getByTestId(TEST_IDS.devices.certificateUnreadable)
    ).toBeVisible()
    await expect(
      mainWindow.getByTestId(TEST_IDS.devices.pairButton)
    ).toBeHidden()

    await mainWindow
      .getByTestId(TEST_IDS.devices.certificateResetButton)
      .click()
    await mainWindow
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Reset', exact: true })
      .click()
    await expect(
      mainWindow.getByTestId(TEST_IDS.devices.certificateUnreadable)
    ).toBeHidden()
    await expect(
      mainWindow.getByTestId(TEST_IDS.devices.pairButton)
    ).toBeVisible()
  })

  test('the plaintext API is not reachable from the LAN', async ({
    mainWindow
  }) => {
    await expect(mainWindow.locator('#root')).toBeVisible()
    const lanAddress = Object.values(networkInterfaces())
      .flatMap((list) => list ?? [])
      .find((i) => i.family === 'IPv4' && !i.internal)?.address
    test.skip(!lanAddress, 'this machine has no LAN address')

    expect(await canConnect('127.0.0.1', 60223)).toBe(true)
    expect(await canConnect(lanAddress!, 60223)).toBe(false)
  })
})
