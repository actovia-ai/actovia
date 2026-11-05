import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

interface Manifest {
  name: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

/** Paths Forge must retain for an external dependency, including nested versions. */
export function runtimePackagePaths(names: string[], root: string): string[] {
  const packageRoot = realpathSync(root)
  const paths = new Set<string>()
  function locate(name: string, from: string): string {
    const require = createRequire(from)
    let entry: string
    try {
      entry = require.resolve(`${name}/package.json`)
    } catch {
      entry = require.resolve(name)
    }
    let dir = dirname(entry)
    for (;;) {
      const manifest = join(dir, 'package.json')
      if (
        existsSync(manifest) &&
        (JSON.parse(readFileSync(manifest, 'utf8')) as Manifest).name === name
      )
        return manifest
      const parent = dirname(dir)
      if (parent === dir)
        throw new Error(`Cannot locate runtime package ${name}`)
      dir = parent
    }
  }
  function visit(name: string, from: string, optional = false) {
    let file: string
    try {
      file = locate(name, from)
    } catch (error) {
      if (optional) return
      throw error
    }
    const path = relative(packageRoot, dirname(file))
    if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`))
      throw new Error(`Runtime dependency ${name} is outside the project`)
    const target = `/${path.split(sep).join('/')}`
    if (paths.has(target)) return
    paths.add(target)
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as Manifest
    for (const dependency of Object.keys(manifest.dependencies ?? {}))
      visit(dependency, file)
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {}))
      visit(dependency, file, true)
    for (const dependency of Object.keys(manifest.peerDependencies ?? {}))
      visit(
        dependency,
        file,
        manifest.peerDependenciesMeta?.[dependency]?.optional === true
      )
  }
  for (const name of names) visit(name, join(packageRoot, 'package.json'))
  return [...paths].sort()
}
