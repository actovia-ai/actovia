import {
  createSourceMapper,
  findBuildRoot,
  SOURCE_MAP_IDLE_MS,
  type StackMapOptions
} from '@actovia-ai/logger'

/**
 * Stack frames in a built file, rewritten to the source line they came from
 * (`@actovia-ai/logger`'s `createSourceMapper`). The build emits a hidden
 * source map beside every file it writes (`build.sourcemap: 'hidden'` in the
 * three Vite configs), so a frame in `…/app.asar/.vite/build/chat-….js:1:91`
 * reads `src/main/lib/…:7:27`.
 *
 * Only files under the running build's own `.vite` directory are looked at:
 * the renderer names the paths in the stacks it reports. Inside `app.asar`
 * the read goes through Electron's patched `fs`.
 */
export { SOURCE_MAP_IDLE_MS, type StackMapOptions }

let runningRoot: string | null | undefined
let rootOverride: string | null | undefined

/**
 * Every chunk of main is written to `<app>/.vite/build` and the renderer to
 * `<app>/.vite/renderer/<name>`, in a dev run and inside `app.asar` alike.
 */
function runningBuildRoot(): string | null {
  if (runningRoot === undefined) {
    runningRoot =
      typeof __dirname === 'string' ? findBuildRoot(__dirname) : null
  }
  return runningRoot
}

const mapper = createSourceMapper({
  root: () => (rootOverride === undefined ? runningBuildRoot() : rootOverride)
})

export function mapStackTrace(
  stack: string,
  options?: StackMapOptions
): string {
  return mapper.mapStackTrace(stack, options)
}

/** Tests only: the root `mapStackTrace` uses when a call names none. */
export function setSourceMapRootForTests(root: string | null): void {
  rootOverride = root
}

/** Tests only. */
export function resetSourceMapsForTests(): void {
  mapper.reset()
  rootOverride = undefined
}
