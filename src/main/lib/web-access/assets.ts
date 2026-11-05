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
    const name = decodeURIComponent(path === '/' ? '/web.html' : path)
    if (name !== '/web.html' && !name.startsWith('/assets/'))
      return new Response(null, { status: 404 })
    if (
      name.includes('\\') ||
      name.split('/').some((part) => part === '.' || part === '..')
    )
      return new Response(null, { status: 404 })
    if (name !== '/web.html' && extname(name) === '.html')
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
    return new Response(data, {
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
