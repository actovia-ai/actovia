import { ACTOVIA_CLI_REPO } from '@actovia/shared/constants/external-urls'
import { useState } from 'react'
import { Trans } from 'react-i18next'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { CommandLine } from './command-line'

// How each package manager installs a global binary. The tab labels are the
// tools' own names, not copy.
const INSTALL_COMMANDS = {
  npm: 'npm i -g @actovia-ai/cli',
  pnpm: 'pnpm add -g @actovia-ai/cli',
  bun: 'bun add -g @actovia-ai/cli'
} as const
type PackageManager = keyof typeof INSTALL_COMMANDS
const PACKAGE_MANAGERS = Object.keys(INSTALL_COMMANDS) as PackageManager[]

const RUN_COMMAND = 'actovia skills'

/**
 * Named `components` (not positional children) so a formatter reflow can't
 * renumber the placeholder; `tests/unit/i18n/settings-namespace.test.ts`
 * renders this exact component and asserts the markup.
 */
export function CliTitle() {
  return (
    <Trans
      ns="settings"
      i18nKey="skillsMarket.cli.title"
      components={{
        cli: (
          <a
            href={ACTOVIA_CLI_REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline underline-offset-2"
          />
        )
      }}
    />
  )
}

/**
 * The terminal route, as a library's quick start: one small terminal block —
 * what it is, pick a package manager, copy two commands. It sits beside the
 * page intro, so the whole header stays one short band above the market.
 */
export function CliQuickStart() {
  const [manager, setManager] = useState<PackageManager>('npm')

  // A soft tray (no border) holding a white sheet with the commands, the
  // package managers as quiet line tabs (ISSUE-294: the boxed, filled tabs
  // read as a form control, not a snippet).
  return (
    <div className="bg-muted/60 rounded-xl p-1">
      {/* Wraps in a long locale or a narrow block rather than squeezing. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2.5 pt-1 pb-1.5">
        <p className="text-muted-foreground text-xs">
          <CliTitle />
        </p>
        <Tabs
          value={manager}
          onValueChange={(value) => setManager(value as PackageManager)}
        >
          <TabsList variant="line" className="group-data-horizontal/tabs:h-5">
            {PACKAGE_MANAGERS.map((name) => (
              <TabsTrigger key={name} value={name} className="px-1 text-xs">
                {name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="bg-background ring-foreground/5 rounded-lg py-1 shadow-xs ring-1">
        <CommandLine bare command={INSTALL_COMMANDS[manager]} />
        <CommandLine bare command={RUN_COMMAND} />
      </div>
    </div>
  )
}
