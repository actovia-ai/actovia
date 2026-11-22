import type { PGliteInterface, Transaction } from '@electric-sql/pglite'

// Parent rows must exist before their children, regardless of ZIP entry order.
export const IMPORTABLE_TABLES = [
  'chat',
  'message',
  'vote',
  'memory',
  'deep_research',
  'deep_research_message'
] as const

export type CsvImport = { tableName: string; blob: Blob }

/** Read the header produced by COPY ... CSV HEADER, including older exports. */
export async function importCsv(
  client: Pick<PGliteInterface | Transaction, 'query'>,
  tableName: string,
  blob: Blob
) {
  if (!IMPORTABLE_TABLES.some((table) => table === tableName)) {
    throw new Error('This table cannot be imported')
  }
  // Our schema identifiers contain no CSV delimiters or embedded newlines.
  // Name columns explicitly so an older export can omit new defaulted columns
  // and a database with a different physical column order imports correctly.
  const header = (await blob.slice(0, 64 * 1024).text())
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/, 1)[0]
  const columns = header
    .split(',')
    .map((value) =>
      value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
    )
  if (
    !columns.length ||
    columns.some((column) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) ||
    new Set(columns).size !== columns.length
  ) {
    throw new Error(`Invalid CSV header in ${tableName}.csv`)
  }
  await client.query(
    `COPY "${tableName}" (${columns.map((column) => `"${column}"`).join(', ')}) FROM '/dev/blob' WITH (FORMAT CSV, HEADER true)`,
    [],
    { blob }
  )
}
