// @actovia-ai/logger's createSourceMapper against a real minified bundle and
// its hidden map (the helper builds it the way a Vite app does).
import { join } from 'node:path'

import {
  createSourceMapper,
  findBuildRoot,
  toAttributes
} from '@actovia-ai/logger'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  buildThrowingBundle,
  type BuiltBundle
} from '../../helpers/built-bundle'

let built: BuiltBundle
let stack: string
beforeAll(async () => {
  built = await buildThrowingBundle()
  stack = built.thrown().stack ?? ''
})
afterAll(() => built.remove())

describe('createSourceMapper', () => {
  it('maps a built frame to its source line, under the root it is given', () => {
    const mapper = createSourceMapper({ root: join(built.app, '.vite') })

    const first = mapper.mapStackTrace(stack).split('\n')[1]

    expect(first).toMatch(/\(src\/main\/lib\/boom\.ts:7:\d+\)$/u)
    mapper.reset()
  })

  it('leaves the stack as it was outside the root or with none', () => {
    const outside = createSourceMapper({ root: join(built.app, 'elsewhere') })
    const none = createSourceMapper({ root: () => null })

    expect(outside.mapStackTrace(stack)).toBe(stack)
    expect(none.mapStackTrace(stack)).toBe(stack)
  })

  it('is what toAttributes maps an Error’s stack with', () => {
    const mapper = createSourceMapper({ root: join(built.app, '.vite') })
    const error = built.thrown()

    const attrs = toAttributes({ error }, mapper.mapStackTrace)

    expect(attrs['exception.stacktrace']).toContain('src/main/lib/boom.ts:7:')
    expect(attrs['exception.stacktrace_raw']).toBe(error.stack)
  })
})

describe('findBuildRoot', () => {
  it('finds the nearest .vite above a built file', () => {
    expect(findBuildRoot(join(built.app, '.vite', 'build'))).toBe(
      join(built.app, '.vite')
    )
    expect(findBuildRoot(join(built.app, 'src', 'main'))).toBeNull()
  })
})
