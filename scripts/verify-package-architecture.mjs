import { open } from 'node:fs/promises'
import { resolve } from 'node:path'

const [platform = process.platform, arch = process.arch] = process.argv.slice(2)
if (!['win32', 'linux'].includes(platform)) process.exit(0)
if (!['x64', 'arm64'].includes(arch))
  throw new Error(`Unsupported architecture: ${arch}`)

async function verify(file) {
  const handle = await open(file, 'r')
  try {
    const bytes = Buffer.alloc(4096)
    await handle.read(bytes, 0, bytes.length, 0)
    const windows = platform === 'win32'
    const machine = windows
      ? bytes.readUInt16LE(bytes.readUInt32LE(0x3c) + 4)
      : bytes.readUInt16LE(18)
    const expected = windows
      ? arch === 'arm64'
        ? 0xaa64
        : 0x8664
      : arch === 'arm64'
        ? 183
        : 62
    if (machine !== expected)
      throw new Error(
        `Wrong binary architecture: ${file} (machine ${machine.toString(16)})`
      )
  } finally {
    await handle.close()
  }
}

const root = resolve('out', `Actovia-${platform}-${arch}`)
await verify(resolve(root, platform === 'win32' ? 'Actovia.exe' : 'Actovia'))
// Loading a host-native package before make isn't sufficient: the ASAR must
// actually ship the matching binding and its shared DuckDB library too.
const duckdb = resolve(
  root,
  'resources/app.asar.unpacked/node_modules/@duckdb',
  `node-bindings-${platform}-${arch}`
)
await verify(resolve(duckdb, 'duckdb.node'))
await verify(
  resolve(duckdb, platform === 'win32' ? 'duckdb.dll' : 'libduckdb.so')
)
console.log(`Verified packaged Electron and DuckDB: ${platform}-${arch}`)
