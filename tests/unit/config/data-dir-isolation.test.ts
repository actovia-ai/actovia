import { tmpdir } from 'os'

import { describe, expect, it } from 'vitest'

describe('unit-test data dir isolation', () => {
  // Dev builds — and therefore any module that resolves getActoviaHome() — use
  // the real ~/.actovia. vitest.config.ts points ACTOVIA_HOME at a scratch dir so
  // a test that forgets to mock db/db.ts can never open the user's database.
  it('runs with ACTOVIA_HOME pointing at a scratch dir, never the real ~/.actovia', () => {
    expect(process.env.ACTOVIA_HOME).toBeTruthy()
    expect(process.env.ACTOVIA_HOME!.startsWith(tmpdir())).toBe(true)
  })
})
