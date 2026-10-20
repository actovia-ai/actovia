import { webcrypto, X509Certificate } from 'crypto'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createSecureContext } from 'tls'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tlsDir = mkdtempSync(join(tmpdir(), 'actovia-tls-'))
let encryptionAvailable = true

// safeStorage stand-in: reversible, and visibly not the plaintext.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (s: string) =>
      Buffer.from(`enc:${Buffer.from(s).toString('hex')}`),
    decryptString: (b: Buffer) =>
      Buffer.from(b.toString('utf8').slice(4), 'hex').toString('utf8')
  }
}))
vi.mock('@main/lib/paths', () => ({ getTlsDir: () => tlsDir }))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { fingerprintOf, loadOrCreateCertificate, resetCertificate } =
  await import('@main/lib/lan/certificate')

beforeEach(() => {
  encryptionAvailable = true
  for (const name of readdirSync(tlsDir)) rmSync(join(tlsDir, name))
})

afterAll(() => rmSync(tlsDir, { recursive: true, force: true }))

describe('LAN certificate', () => {
  it('creates a certificate Node accepts, valid for about ten years', async () => {
    const { certPem } = await loadOrCreateCertificate()
    const parsed = new X509Certificate(certPem)

    expect(parsed.subject).toContain('CN=Actovia')
    const years = (Date.parse(parsed.validTo) - Date.now()) / (365 * 864e5)
    expect(years).toBeGreaterThan(9.9)
    expect(years).toBeLessThan(10.1)
  })

  // A v3 certificate with no extensions is refused by Apple's TLS stack during
  // the handshake, before the app's trust delegate is consulted — the phone
  // could never pin it. These are what clear that bar.
  it('carries the extensions a TLS server certificate needs', async () => {
    const { certPem } = await loadOrCreateCertificate()
    const parsed = new X509Certificate(certPem)
    await import('reflect-metadata')
    const x509 = await import('@peculiar/x509')
    const cert = new x509.X509Certificate(certPem)

    expect(parsed.ca).toBe(false)
    // Node's `keyUsage` is the *extended* key usage, as OIDs.
    expect(parsed.keyUsage).toEqual([x509.ExtendedKeyUsage.serverAuth])
    expect(parsed.subjectAltName).toMatch(/^DNS:.+\.local$/)
    const keyUsage = cert.getExtension(x509.KeyUsagesExtension)
    expect(keyUsage?.usages).toBe(
      x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment
    )
    expect(cert.getExtension(x509.BasicConstraintsExtension)?.ca).toBe(false)
  })

  it('replaces a certificate from before the extensions were added', async () => {
    await import('reflect-metadata')
    const x509 = await import('@peculiar/x509')
    x509.cryptoProvider.set(webcrypto as Crypto)
    const alg = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' }
    const keys = await webcrypto.subtle.generateKey(alg, true, [
      'sign',
      'verify'
    ])
    const bare = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: '01',
      name: 'CN=Actovia',
      keys,
      signingAlgorithm: alg,
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 864e5)
    })
    const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)
    const keyPem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64')}\n-----END PRIVATE KEY-----\n`
    writeFileSync(join(tlsDir, 'cert.pem'), bare.toString('pem'))
    writeFileSync(join(tlsDir, 'key.enc'), keyPem)
    const bareFingerprint = fingerprintOf(bare.toString('pem'))

    const replaced = await loadOrCreateCertificate()

    expect(replaced.fingerprint).not.toBe(bareFingerprint)
    expect(new X509Certificate(replaced.certPem).subjectAltName).toBeDefined()
    // And it sticks: the next load is the replacement, not another one.
    expect((await loadOrCreateCertificate()).fingerprint).toBe(
      replaced.fingerprint
    )
  })

  it('can serve TLS: the key matches the certificate', async () => {
    const { certPem, keyPem } = await loadOrCreateCertificate()

    expect(() =>
      createSecureContext({ cert: certPem, key: keyPem })
    ).not.toThrow()
    expect(
      new X509Certificate(certPem).checkPrivateKey(
        (await import('crypto')).createPrivateKey(keyPem)
      )
    ).toBe(true)
  })

  it('keeps the same fingerprint across loads — devices pin it', async () => {
    const first = await loadOrCreateCertificate()
    const second = await loadOrCreateCertificate()

    expect(second.fingerprint).toBe(first.fingerprint)
    expect(second.keyPem).toBe(first.keyPem)
    expect(first.fingerprint).toBe(fingerprintOf(first.certPem))
    // base64url of 32 bytes, unpadded
    expect(first.fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('never writes the private key in the clear when safeStorage works', async () => {
    const { keyPem } = await loadOrCreateCertificate()
    const secretLine = keyPem.split('\n')[1]

    for (const name of readdirSync(tlsDir)) {
      expect(readFileSync(join(tlsDir, name), 'utf8')).not.toContain(secretLine)
    }
  })

  it('still works, unencrypted, where safeStorage is unavailable', async () => {
    encryptionAvailable = false
    const created = await loadOrCreateCertificate()
    const loaded = await loadOrCreateCertificate()

    expect(loaded.keyPem).toBe(created.keyPem)
    expect(loaded.fingerprint).toBe(created.fingerprint)
  })

  it('reset issues a different certificate, and that one sticks', async () => {
    const before = await loadOrCreateCertificate()
    const after = await resetCertificate()

    expect(after.fingerprint).not.toBe(before.fingerprint)
    expect((await loadOrCreateCertificate()).fingerprint).toBe(
      after.fingerprint
    )
  })
})
