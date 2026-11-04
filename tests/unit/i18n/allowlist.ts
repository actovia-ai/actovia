/**
 * Permanent exceptions to the hardcoded-string guard
 * (`no-hardcoded-strings.test.ts`). Every entry is a genuine proper noun,
 * brand name, or technical identifier that must never be translated —
 * this is not a place to park deferred i18n debt. `file` is repo-relative;
 * `text` must match the flagged string exactly.
 */
export interface AllowlistEntry {
  file: string
  text: string
  /** The line the guard's scanner reports for this violation today. Pinning
   *  this (rather than matching on `file`+`text` alone) keeps the allowlist
   *  from silently exempting some unrelated future occurrence of the same
   *  short string elsewhere in the same file (e.g. "MIT" also appearing in
   *  a new sentence) — the staleness test re-scans the file and fails if a
   *  violation no longer exists at exactly this file/line/text triple. */
  line: number
  reason: string
}

export const ALLOWLIST: AllowlistEntry[] = [
  {
    file: 'src/renderer/components/app/apps-dialog.tsx',
    text: 'actovia',
    line: 185,
    reason: 'The CLI executable name, shown as the terminal title.'
  },
  {
    file: 'src/renderer/components/calling-tools/artifact/artifact-card.tsx',
    text: 'artifact://',
    line: 112,
    reason: "The app's own URI scheme prefix, not user-facing prose."
  },
  {
    file: 'src/renderer/components/calling-tools/drawio/drawio-card.tsx',
    text: 'draw.io ·',
    line: 139,
    reason: "draw.io is the third-party product's own brand name."
  },
  {
    file: 'src/renderer/components/settings/settings-form/system-info.tsx',
    text: 'actovia-ai/actovia',
    line: 141,
    reason: 'GitHub org/repo slug, a proper noun.'
  },
  {
    file: 'src/renderer/components/settings/settings-form/system-info.tsx',
    text: '@actovia_ai',
    line: 144,
    reason: 'Social handle, a proper noun.'
  },
  {
    file: 'src/renderer/components/settings/settings-form/system-info.tsx',
    text: 'actovia.yancey.app',
    line: 147,
    reason: 'Website domain, a proper noun.'
  },
  {
    file: 'src/renderer/components/settings/settings-form/system-info.tsx',
    text: 'MIT',
    line: 150,
    reason: 'Software license name — never translated.'
  },
  {
    file: 'src/renderer/components/settings/settings-form/agents.tsx',
    text: '~/Actovia Projects',
    line: 134,
    reason: 'The default projects folder — a path on disk, never translated.'
  },
  {
    file: 'src/renderer/components/settings/settings-form/mcp-servers.tsx',
    text: '{"GITHUB_TOKEN": "ghp_..."}',
    line: 887,
    reason: 'A JSON example of the env field — its syntax, not prose.'
  }
  // The headers field moved from a plain Input placeholder to a Monaco JSON
  // editor (no `placeholder` attribute), so the old `{"Authorization":
  // "Bearer token"}` allowlist entry no longer matches any violation and was
  // removed — the staleness test enforces that.
]
