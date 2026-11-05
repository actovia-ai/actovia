import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join, resolve, sep } from 'path'

import { getArtifactsDir } from '../paths'

export interface ArtifactMeta {
  id: string
  chatId: string
  title: string
  createdAt: string
}

/**
 * `<artifacts>/<chatId>`, or null when `chatId` / `artifactId` would climb out
 * of it. Both reach this module straight from URL params
 * (`/api/v1/library/:chatId/:artifactId`, where `..%2F` decodes to `../`), so
 * without the check the route read any `.tsx` / `.json` on disk and `mkdir`ed
 * wherever it was pointed. Same rule as the `reveal-artifact-file` IPC.
 */
function resolveChatDir(chatId: string, artifactId?: string): string | null {
  const base = resolve(getArtifactsDir())
  const dir = resolve(base, chatId)
  if (!dir.startsWith(base + sep)) return null
  if (artifactId !== undefined) {
    const file = resolve(dir, `${artifactId}.tsx`)
    if (!file.startsWith(dir + sep)) return null
  }
  return dir
}

function getChatArtifactsDir(chatId: string, artifactId: string): string {
  const dir = resolveChatDir(chatId, artifactId)
  if (!dir) throw new Error('Invalid artifact path')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export async function saveArtifact(
  chatId: string,
  artifactId: string,
  title: string,
  code: string
): Promise<string> {
  const dir = getChatArtifactsDir(chatId, artifactId)
  const filePath = join(dir, `${artifactId}.tsx`)
  const metaPath = join(dir, `${artifactId}.json`)

  await writeFile(filePath, code, 'utf-8')
  await writeFile(
    metaPath,
    JSON.stringify(
      { id: artifactId, chatId, title, createdAt: new Date().toISOString() },
      null,
      2
    ),
    'utf-8'
  )

  return filePath
}

export function getArtifact(
  chatId: string,
  artifactId: string
): { code: string; meta: ArtifactMeta } | null {
  const dir = resolveChatDir(chatId, artifactId)
  if (!dir) return null
  const filePath = join(dir, `${artifactId}.tsx`)
  const metaPath = join(dir, `${artifactId}.json`)

  if (!existsSync(filePath)) return null

  const code = readFileSync(filePath, 'utf-8')
  const meta = existsSync(metaPath)
    ? (JSON.parse(readFileSync(metaPath, 'utf-8')) as ArtifactMeta)
    : { id: artifactId, chatId, title: artifactId, createdAt: '' }

  return { code, meta }
}

export function listArtifacts(chatId: string): ArtifactMeta[] {
  const dir = resolveChatDir(chatId)
  if (!dir || !existsSync(dir)) return []

  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as ArtifactMeta)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
}
