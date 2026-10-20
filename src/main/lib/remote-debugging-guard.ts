import { app } from 'electron'

import { refuseRemoteDebugging } from './remote-debugging'

// Imported first by main.ts. The bundler still evaluates the shared chunks
// main.js requires ahead of it (db/db.ts takes the single-instance lock and
// starts constructing PGlite), but this exits synchronously, before PGlite's
// asynchronous init touches the database, before `ready`, before any window —
// and before Chromium's DevTools endpoint comes up: a packaged build started
// with `--remote-debugging-port` exits 1 without ever printing "DevTools
// listening on …" (checked by hand on a packaged build, 2026-09-25). See
// remote-debugging.ts.
if (
  refuseRemoteDebugging({
    isPackaged: app.isPackaged,
    argv: process.argv,
    commandLine: app.commandLine,
    exit: (code) => app.exit(code),
    log: (message, attributes) => {
      process.stderr.write(
        `[actovia] ${message} ${JSON.stringify(attributes)}\n`
      )
    }
  })
) {
  // Right now, before the next module is evaluated. In Electron's main
  // process `process.exit` is `app.exit`, which is not documented as a
  // synchronous exit (single-instance.ts observed it stopping what followed,
  // in its own context; this guard does not rely on that): the rest of the
  // bundle (db/db.ts opening PGlite, …) could still run first. `reallyExit`
  // is Node's own, synchronous exit.
  const { reallyExit } = process as unknown as {
    reallyExit?: (code: number) => never
  }
  if (reallyExit) reallyExit.call(process, 1)
  throw new Error('Refusing to start with a remote-debugging switch')
}
