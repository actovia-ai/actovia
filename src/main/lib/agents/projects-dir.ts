import { realpath } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join, resolve, sep } from 'path'

import { ErrorCode, ValidationError } from '@actovia/shared'

import { getActoviaHome } from '../paths'

/** The real path of `p` even when it does not exist yet: its nearest existing ancestor, resolved, plus the rest. */
async function resolveLoosely(p: string): Promise<string> {
  const rest: string[] = []
  let current = p
  for (;;) {
    try {
      return join(await realpath(current), ...rest.toReversed())
    } catch {
      const parent = dirname(current)
      if (parent === current) return p
      rest.push(current.slice(parent.length).replaceAll(sep, ''))
      current = parent
    }
  }
}

/** Where agents work must not be `/`, the home folder, Actovia' data, or hold either. */
export async function assertProjectsDirAllowed(dir: string): Promise<void> {
  const fail = (m: string): never => {
    throw new ValidationError(ErrorCode.VALIDATION_FAILED, m)
  }
  const expanded = dir.startsWith('~') ? join(homedir(), dir.slice(1)) : dir
  const target = await resolveLoosely(resolve(expanded))
  const home = await resolveLoosely(homedir())
  const data = await resolveLoosely(getActoviaHome())
  if (target === sep) fail('The root folder cannot be used')
  if (target === home)
    fail('Your home folder is too broad — choose a folder inside it')
  if (target === data || target.startsWith(data + sep))
    fail("Actovia's own data folder cannot be used")
  if (home.startsWith(target + sep) || data.startsWith(target + sep))
    fail(
      "This folder contains your home folder or Actovia's data — choose a folder inside it"
    )
}
