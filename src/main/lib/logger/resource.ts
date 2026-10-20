import { randomBytes } from 'node:crypto'
import { release, type } from 'node:os'

import { app } from 'electron'

export interface Resource {
  'service.name': 'actovia'
  'service.version': string
  'process.pid': number
  'process.runtime.name': 'electron'
  'os.type': string
  'os.version': string
  'session.id': string
}

// One id per app launch — distinguishes runs within a single day's log file
// (crash → relaunch appends to the same YYYY-MM-DD.jsonl).
const SESSION_ID = randomBytes(8).toString('hex')

let cached: Resource | null = null

function resolveVersion(): string {
  try {
    const v = app.getVersion()
    if (typeof v === 'string' && v.length > 0) return v
  } catch {
    // Not a ready Electron main process (unit tests) — fall through.
  }
  return '0.0.0'
}

export function getResource(): Resource {
  if (cached) return cached
  cached = Object.freeze({
    'service.name': 'actovia',
    'service.version': resolveVersion(),
    'process.pid': process.pid,
    'process.runtime.name': 'electron',
    'os.type': type(),
    'os.version': release(),
    'session.id': SESSION_ID
  })
  return cached
}
