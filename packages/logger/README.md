# @actovia-ai/logger

OpenTelemetry-shaped logging for a Node process, without the OpenTelemetry
SDK. Each record is one JSON line in a per-day file. Each unit of work gets a
trace id through `AsyncLocalStorage`, so every line it logs carries the same
id. An Error is recorded with its stack. Frames in a built file can be mapped
back to the source line through the hidden source maps your bundler writes.
The only dependency is `@jridgewell/trace-mapping`.

```ts
import {
  createLogger,
  createResource,
  createSourceMapper,
  findBuildRoot,
  withTrace
} from '@actovia-ai/logger'

const resource = createResource({ serviceName: 'acme', version: '1.2.3' })
const maps = createSourceMapper({ root: () => findBuildRoot(__dirname) })

const logger = createLogger({
  dir: () => '/var/log/acme', // <local day>.jsonl in here
  resource: () => resource,
  mask: (line) => line.replaceAll(apiKey, '••••'), // optional
  mapStack: maps.mapStackTrace // optional
})

// Everything logged inside shares one traceId.
await withTrace(() => handle(request), { attributes: { route: '/charge' } })

try {
  await charge()
} catch (error) {
  logger.error('billing', 'charge failed', { error }) // the Error itself
}
```

A line looks like this:

```json
{
  "timestamp": "2026-10-28T02:41:07.112Z",
  "severityNumber": 17,
  "severityText": "ERROR",
  "body": "charge failed",
  "scope": { "name": "billing" },
  "attributes": {
    "route": "/charge",
    "exception.type": "TypeError",
    "exception.message": "Cannot read properties of undefined (reading 'id')",
    "exception.stacktrace": "TypeError: …\n    at e (src/billing.ts:7:27)",
    "exception.stacktrace_raw": "TypeError: …\n    at e (/srv/acme/.vite/build/index-Cw3Z.js:1:91)"
  },
  "resource": { "service.name": "acme", "service.version": "1.2.3", "…": "…" },
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

| Export                                                   | What it does                                                                                                                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createLogger(options)`                                  | `{ debug, info, warn, error }(surface, message, detail?)`. Appends the record without waiting for the write and never throws into its caller. Options: `dir`, `minSeverity`, `resource`, `mask`, `mapStack`, `fileName`, `console`. |
| `withTrace(fn, { originTraceId?, attributes? })`         | Runs `fn` in a fresh trace. Nested traces shadow the outer one. `currentTrace()` returns the active trace; `bindTraceAttributes()` adds attributes to it.                                                                           |
| `toAttributes(detail, mapStack?)`                        | Turns `detail.error` into `exception.type`, `.message` and `.stacktrace`, plus `.stacktrace_raw` when mapping changed the stack.                                                                                                    |
| `stackFramesOf(error, mapStack?)`                        | The frames only, without the name or message. Use it when the message may quote something that must not be written.                                                                                                                 |
| `createSourceMapper({ root, idleMs? })`                  | Rewrites frames that point into a file under `root` to `source:line:column`. Each map is read on first use and dropped after five minutes with no stack to map. Nothing here throws.                                                |
| `findBuildRoot(dir, name = '.vite')`                     | The nearest build directory at or above `dir`.                                                                                                                                                                                      |
| `createResource({ serviceName, version, runtimeName? })` | Service, process, OS and a per-process session id.                                                                                                                                                                                  |
| `cleanupOldLogs(dir, days)`                              | Deletes day files older than `days`.                                                                                                                                                                                                |
| `normalizeToLogRecord(json)`                             | A parsed line as a `LogRecord`, or `null` to skip it.                                                                                                                                                                               |

MIT.
