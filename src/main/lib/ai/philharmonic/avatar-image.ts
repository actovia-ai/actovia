import { readFile } from 'fs/promises'
import { createRequire } from 'module'

import {
  AVATAR_STYLES,
  type AvatarStyle,
  DEFAULT_AVATAR_STYLE
} from '@actovia/shared/constants/avatar'
import { Avatar, Style } from '@dicebear/core'
import adventurer from '@dicebear/styles/adventurer.json'
import notionists from '@dicebear/styles/notionists.json'
import thumbs from '@dicebear/styles/thumbs.json'

/**
 * An employee's DiceBear avatar, drawn in main for a client that cannot run
 * DiceBear itself (actovia-ios, ISSUE-296): `GET /api/v1/philharmonic/avatar`.
 *
 * The SVG is made exactly as the renderer's `EmployeeAvatar` makes it — same
 * style definitions, the same fallbacks (no seed → `'default'`, an unknown
 * style → `DEFAULT_AVATAR_STYLE`) — so the phone shows the face the desktop
 * shows. It is rasterised to a PNG with resvg's WebAssembly build (no native
 * binary; the `.wasm` is read from the package, which vite.main.config.mts
 * keeps external and forge.config.ts ships), because iOS has no SVG renderer.
 * The hue disc and ring around it are the client's to draw, as the
 * renderer's wrapper draws them: the PNG is the figure alone, transparent.
 */

const DEFINITIONS: Record<AvatarStyle, unknown> = {
  notionists,
  thumbs,
  adventurer
}

const styles = new Map<AvatarStyle, Style>()

export const AVATAR_SIZE_MIN = 16
export const AVATAR_SIZE_MAX = 512
export const AVATAR_SIZE_DEFAULT = 128
export const AVATAR_SEED_MAX = 256

/** The style the renderer would draw for `style`: unknown or missing → the default. */
export function resolveAvatarStyle(
  style: string | null | undefined
): AvatarStyle {
  return style && (AVATAR_STYLES as readonly string[]).includes(style)
    ? (style as AvatarStyle)
    : DEFAULT_AVATAR_STYLE
}

/** The avatar's SVG, byte for byte the renderer's (`EmployeeAvatar`). */
export function avatarSvg(
  seed: string | null | undefined,
  style: string | null | undefined
): string {
  const key = resolveAvatarStyle(style)
  let instance = styles.get(key)
  if (!instance) {
    instance = new Style(DEFINITIONS[key])
    styles.set(key, instance)
  }
  return new Avatar(instance, { seed: seed ?? 'default' }).toString()
}

type ResvgModule = typeof import('@resvg/resvg-wasm')

let resvgPromise: Promise<ResvgModule> | null = null

/** resvg, its WebAssembly instantiated once, on the first avatar asked for. */
function loadResvg(): Promise<ResvgModule> {
  if (!resvgPromise) {
    resvgPromise = (async () => {
      const mod = await import('@resvg/resvg-wasm')
      const wasmPath = createRequire(import.meta.url).resolve(
        '@resvg/resvg-wasm/index_bg.wasm'
      )
      await mod.initWasm(await readFile(wasmPath))
      return mod
    })().catch((error: unknown) => {
      // A failed start is not remembered: the next request tries again.
      resvgPromise = null
      throw error
    })
  }
  return resvgPromise
}

/** A few dozen employees at most: the PNGs a client has asked for, newest last. */
const CACHE_LIMIT = 128
const cache = new Map<string, Uint8Array>()

/** The avatar as a `size` × `size` PNG with a transparent background. */
export async function avatarPng(
  seed: string | null | undefined,
  style: string | null | undefined,
  size: number
): Promise<Uint8Array> {
  const key = `${resolveAvatarStyle(style)}\u0000${size}\u0000${seed ?? 'default'}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const { Resvg } = await loadResvg()
  const resvg = new Resvg(avatarSvg(seed, style), {
    fitTo: { mode: 'width', value: size }
  })
  const rendered = resvg.render()
  const png = rendered.asPng()
  rendered.free()
  resvg.free()
  cache.set(key, png)
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return png
}
