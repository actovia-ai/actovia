import { spawn } from 'child_process'
import { mkdir, open } from 'fs/promises'
import { join } from 'path'

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

const schema = Type.Object({
  command: Type.String({
    description: 'shell command to run in the background'
  })
})

export function startBackground(cwd: string): AgentTool<typeof schema> {
  return {
    name: 'start_background',
    label: 'Start Background Task',
    description:
      'Start a long-running command in this Group workspace. Returns relative log and exit-marker paths to give the PM through watchFor.',
    parameters: schema,
    execute: async (_id, { command }) => {
      const dir = join(cwd, '.actovia', 'watch')
      await mkdir(dir, { recursive: true })
      const id = crypto.randomUUID()
      const logPath = join('.actovia', 'watch', `${id}.log`)
      const exitPath = join('.actovia', 'watch', `${id}.exit`)
      const log = await open(join(cwd, logPath), 'a')
      const child = spawn(
        '/bin/sh',
        [
          '-lc',
          `${command}; code=$?; printf '%s' "$code" > ${JSON.stringify(join(cwd, exitPath))}`
        ],
        { cwd, detached: true, stdio: ['ignore', log.fd, log.fd] }
      )
      child.unref()
      await log.close()
      const details = { pid: child.pid, logPath, exitPath }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(details) }],
        details
      }
    }
  } as AgentTool<typeof schema>
}
