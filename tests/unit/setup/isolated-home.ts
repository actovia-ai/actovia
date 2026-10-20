import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterAll } from 'vitest'

// Every test file gets its own scratch data dir (vitest.config.ts sets the
// shared default; this narrows it per file). Files run in parallel, and some
// state under the data dir is read back by other code — the moved-secrets
// re-entry list (`secrets/moved.ts`), the logs — so one file's writes must
// never show up in another's reads.
const home = mkdtempSync(join(tmpdir(), 'actovia-unit-tests-home-'))
process.env.ACTOVIA_HOME = home

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})
