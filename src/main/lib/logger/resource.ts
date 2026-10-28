import { createResource } from '@actovia-ai/logger'
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
  cached ??= createResource({
    serviceName: 'actovia',
    version: resolveVersion(),
    runtimeName: 'electron'
  }) as Resource
  return cached
}
