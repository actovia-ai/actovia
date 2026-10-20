import { exec } from 'child_process'
import { mkdir } from 'fs/promises'
import { homedir } from 'os'
import { promisify } from 'util'

import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

const execAsync = promisify(exec)

const terminalSchema = Type.Object({
  command: Type.String({ description: 'The shell command to execute.' }),
  cwd: Type.Optional(
    Type.String({
      description:
        'Working directory for the command. Defaults to the workspace directory named in the system prompt.'
    })
  )
})

/**
 * @param defaultCwd where a command runs when the model names no `cwd` —
 *   the chat's workspace (`getChatWorkspaceDir`), created on first use so an
 *   unused chat leaves no directory behind. The user's home when unbound.
 */
export const terminal = (
  defaultCwd: string = homedir()
): AgentTool<typeof terminalSchema> => ({
  name: TOOL_NAMES.terminal,
  label: 'Terminal',
  description: `Execute a shell command on the local machine and return its output. Use this to run CLI tools, scripts, or any shell command. Commands run in the workspace directory by default (see the system prompt); pass cwd to run elsewhere.

LANGUAGE PREFERENCE
- Always PREFER Node.js inline (\`node -e "..."\`) for ad-hoc scripting. Node's built-ins cover most tasks: \`fetch\`, \`JSON\`, \`URL\`, \`Date\`, \`Math\`, \`crypto\`, \`fs\`, \`path\` — no install needed.
- Use Python only when the task genuinely needs its scientific stack (pandas, numpy, scipy, yfinance, etc.).

THIRD-PARTY NODE PACKAGES
- Use \`npx --yes --package=<pkg1> --package=<pkg2> node -e "..."\` for ephemeral package usage. First run downloads (~5-10s); subsequent runs are cached by npm.

MISSING DEPENDENCIES — DO NOT AUTO-INSTALL, ASK THE USER
- If a required CLI or library is missing — \`python3\`, \`uv\`, \`brew\`, a specific Python package, a system tool, anything — DO NOT attempt to install it yourself. No \`pip install\`, no \`brew install\`, no \`npm install -g\`, no \`sudo\` of any kind.
- Instead, stop the task immediately and tell the user in plain language:
  - what is missing
  - the exact install command they should run (e.g. "Please run \`brew install uv\` and then ask me to retry")
- Wait for the user to confirm before retrying. Do not try alternative install paths or silent workarounds.

Commands run with the user's full OS privileges. Avoid destructive operations.`,
  parameters: terminalSchema,
  execute: async (_toolCallId, { command, cwd }, signal) => {
    if (signal?.aborted) throw new Error('Aborted')
    const workDir = cwd ?? defaultCwd
    try {
      if (!cwd) await mkdir(workDir, { recursive: true })
      const { stdout, stderr } = await execAsync(command, {
        cwd: workDir,
        timeout: 30_000,
        maxBuffer: 1024 * 1024 * 10, // 10 MB
        signal
      })
      const details = {
        command,
        cwd: workDir,
        exitCode: 0,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd()
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(details) }],
        details
      }
    } catch (err: unknown) {
      const e = err as {
        code?: number
        stdout?: string
        stderr?: string
        message?: string
      }
      const details = {
        command,
        cwd: workDir,
        exitCode: e.code ?? 1,
        stdout: (e.stdout ?? '').trimEnd(),
        stderr: (e.stderr ?? e.message ?? 'Unknown error').trimEnd()
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(details) }],
        details
      }
    }
  }
})
