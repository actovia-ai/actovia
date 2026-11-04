import { realpath, stat, readdir, readFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import JSZip from 'jszip'

export type ArchiveEntry = {
  kind: 'archive'
  title: string
  path: string
  directory: boolean
}

export async function archivePath(workspace: string, path: string) {
  const root = await realpath(workspace)
  const real = await realpath(resolve(root, path))
  const rel = relative(root, real)
  if (
    rel === '..' ||
    rel.startsWith(`..${sep}`) ||
    rel.split(sep).includes('.actovia')
  )
    throw new Error(
      'Archive must be a deliverable inside the working folder, outside internal metadata.'
    )
  const info = await stat(real)
  if (!info.isFile() && !info.isDirectory())
    throw new Error('Archive must be a regular file or folder.')
  return { path: real, directory: info.isDirectory() }
}

export function archiveOutput(
  workspace: string,
  onArchive: (entry: ArchiveEntry) => void
): AgentTool {
  return {
    name: 'archive_output',
    label: 'Archive Output',
    description:
      'Register a verified final file or folder as a completed deliverable. Finish and inspect it first. Archive only the final report, document, or delivery folder; never logs, scratch files, progress notes or visual Artifacts. Use a relative path inside the working folder.',
    parameters: Type.Object({ title: Type.String(), path: Type.String() }),
    execute: async (_id, { title, path }: { title: string; path: string }) => {
      const entry: ArchiveEntry = {
        kind: 'archive',
        title,
        ...(await archivePath(workspace, path))
      }
      onArchive(entry)
      return {
        content: [{ type: 'text', text: `Archived ${title}: ${entry.path}` }],
        details: entry
      }
    }
  } as AgentTool
}

/** A small delivery folder can be shared on a phone without revealing host paths. */
export async function downloadArchive(item: {
  path: string
  directory: boolean
}) {
  if (!item.directory)
    return {
      name: basename(item.path),
      data: new Uint8Array(await readFile(item.path))
    }
  const zip = new JSZip()
  let bytes = 0
  let count = 0
  const walk = async (dir: string, prefix: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (
        entry.isSymbolicLink() ||
        ['.git', '.actovia', 'node_modules'].includes(entry.name)
      )
        continue
      const path = join(dir, entry.name)
      const name = `${prefix}${entry.name}`
      if (entry.isDirectory()) {
        zip.folder(name)
        await walk(path, `${name}/`)
      } else if (entry.isFile()) {
        const info = await stat(path)
        bytes += info.size
        if (++count > 1000 || bytes > 64 * 1024 * 1024)
          throw new Error(
            'Delivery folder is too large to download. Archive a smaller final folder.'
          )
        zip.file(name, await readFile(path))
      }
    }
  }
  await walk(item.path, '')
  return {
    name: `${basename(item.path)}.zip`,
    data: await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE'
    })
  }
}
