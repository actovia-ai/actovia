import { existsSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
}

/** Only the dedicated entry and compiled assets, never the desktop HTML/source maps. */
export async function webAsset(root: string, path: string): Promise<Response> {
  try {
    const sandboxPrefix = '/api/v1/artifacts/sandbox'
    const sandbox = path.startsWith(`${sandboxPrefix}/`)
    const name = decodeURIComponent(
      sandbox
        ? path.slice(sandboxPrefix.length)
        : path === '/'
          ? '/web.html'
          : path
    )
    const sandboxPage =
      sandbox && name === '/src/renderer/sub-apps/artifacts/index.html'
    if (
      sandbox
        ? !sandboxPage && !name.startsWith('/assets/')
        : name !== '/web.html' && !name.startsWith('/assets/')
    )
      return new Response(null, { status: 404 })
    if (
      name.includes('\\') ||
      name.split('/').some((part) => part === '.' || part === '..')
    )
      return new Response(null, { status: 404 })
    if (!sandboxPage && name !== '/web.html' && extname(name) === '.html')
      return new Response(null, { status: 404 })
    const type = TYPES[extname(name)]
    if (!type) return new Response(null, { status: 404 })
    const base = await realpath(root)
    const file = await realpath(resolve(base, `.${name}`))
    const inside = relative(base, file)
    if (
      !inside ||
      isAbsolute(inside) ||
      inside === '..' ||
      inside.startsWith(`..${sep}`) ||
      resolve(file) === base
    )
      return new Response(null, { status: 404 })
    const data = await readFile(file)
    let body: Uint8Array | string = data
    if (sandbox && /(?:html|javascript|css)/u.test(type)) {
      body = data
        .toString('utf8')
        .replaceAll('/assets/', `${sandboxPrefix}/assets/`)
      // The HTTP CSP supplies the exact host for this opaque-origin runtime.
      if (sandboxPage)
        body = body.replace(
          /<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*"\s*\/>/u,
          ''
        )
    }
    return new Response(body, {
      headers: {
        'Content-Type': type,
        'Cache-Control':
          name === '/web.html'
            ? 'no-store'
            : 'private, max-age=31536000, immutable'
      }
    })
  } catch {
    return new Response(
      path === '/'
        ? 'Web assets are unavailable. In development, run bun run build:web.'
        : 'Not found.',
      { status: path === '/' ? 503 : 404 }
    )
  }
}

/** Resolve per request: a running dev listener can recover after assets rebuild. */
export function webRendererAsset(
  appPath: string,
  packaged: boolean,
  renderer: string,
  path: string
): Promise<Response> {
  const development = resolve(appPath, '.vite', 'web')
  const root =
    !packaged && existsSync(resolve(development, 'web.html'))
      ? development
      : resolve(appPath, '.vite', 'renderer', renderer)
  return webAsset(root, path)
}
