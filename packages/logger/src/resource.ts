import { randomBytes } from 'node:crypto'
import { release, type } from 'node:os'

export interface Resource {
  'service.name': string
  'service.version': string
  'process.pid': number
  'process.runtime.name': string
  'os.type': string
  'os.version': string
  'session.id': string
}

// One id per process — distinguishes runs within a single day's log file
// (crash → relaunch appends to the same YYYY-MM-DD.jsonl).
const SESSION_ID = randomBytes(8).toString('hex')

/** The resource every record of this process carries. */
export function createResource({
  serviceName,
  version,
  runtimeName = 'node'
}: {
  serviceName: string
  version: string
  runtimeName?: string
}): Resource {
  return Object.freeze({
    'service.name': serviceName,
    'service.version': version,
    'process.pid': process.pid,
    'process.runtime.name': runtimeName,
    'os.type': type(),
    'os.version': release(),
    'session.id': SESSION_ID
  })
}
