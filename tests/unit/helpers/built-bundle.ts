// A real built file that throws, with its hidden source map beside it —
// what the source-map tests map a stack against. Vite builds it the way the
// app's own build does (minified, `sourcemap: 'hidden'`), into a scratch
// directory laid out like the app: `<app>/src/…` and `<app>/.vite/build/…`.
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { build } from 'vite'

/** `src/main/lib/boom.ts`: the throw is on line 7. */
const BOOM = `export interface Usage {
  totalTokens: number
}

export function readTotal(usage: Usage | undefined): number {
  // The throw is on line 7.
  return (usage as Usage).totalTokens
}
`

/** `src/main/main.ts`: calls it on line 4, and on line 9 from async code. */
const MAIN = `import { readTotal } from './lib/boom'

export function run(): number {
  return readTotal(undefined)
}

export async function runAsync(): Promise<number> {
  await Promise.resolve()
  return readTotal(undefined)
}
`

export interface BuiltBundle {
  /** The scratch app root. */
  app: string
  /** The directory the bundle was built into. */
  outDir: string
  /** The built file, `<outDir>/main.js`; its map is `<file>.map`. */
  file: string
  /** Runs the built `run()` and returns the Error it threw. */
  thrown: () => Error
  /** The same from the built async function. */
  thrownAsync: () => Promise<Error>
  remove: () => void
}

export async function buildThrowingBundle(
  outDir = '.vite/build'
): Promise<BuiltBundle> {
  // The real path: `require` resolves the symlink macOS keeps its temp dir
  // behind, and the frames carry what it resolved to.
  const app = realpathSync(mkdtempSync(join(tmpdir(), 'actovia-built-')))
  mkdirSync(join(app, 'src/main/lib'), { recursive: true })
  writeFileSync(join(app, 'src/main/lib/boom.ts'), BOOM)
  writeFileSync(join(app, 'src/main/main.ts'), MAIN)
  await build({
    root: app,
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: false,
      minify: true,
      sourcemap: 'hidden',
      lib: {
        entry: 'src/main/main.ts',
        fileName: () => '[name].js',
        formats: ['cjs']
      }
    }
  })
  const file = join(app, outDir, 'main.js')
  const built = createRequire(import.meta.url)(file) as {
    run: () => number
    runAsync: () => Promise<number>
  }
  return {
    app,
    outDir: join(app, outDir),
    file,
    thrown: () => {
      try {
        built.run()
      } catch (error) {
        return error as Error
      }
      throw new Error('the built run() did not throw')
    },
    thrownAsync: () =>
      built.runAsync().then(
        () => {
          throw new Error('the built runAsync() did not reject')
        },
        (error: Error) => error
      ),
    remove: () => rmSync(app, { recursive: true, force: true })
  }
}
