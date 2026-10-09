import { execFile } from 'child_process'

export const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
export const appleScriptString = (s: string) =>
  `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

/** Backslash-escapes a path so sh, bash, zsh and fish all read it as one word. */
export const shellEscapePath = (s: string) =>
  s.replaceAll(/[^\w./-]/gu, (ch) => `\\${ch}`)

/** What the session was started with; refuses anything else before it is typed or written. */
export const isCliSessionId = (s: string) => /^[0-9a-f-]{8,64}$/iu.test(s)

/**
 * The resume script: `/bin/sh` parses the quoting (the owner's interactive
 * shell may be fish, which reads `\'` inside single quotes differently).
 */
export const resumeScript = (
  cwd: string,
  binPath: string,
  cliSessionId: string
) =>
  `#!/bin/sh\ncd ${shellQuote(cwd)} && exec ${shellQuote(binPath)} --resume ${shellQuote(cliSessionId)}\n`

/** Spec §5: the owner takes the session over by hand, in Terminal.app — running our script, no typed arguments. */
export function openInTerminal(scriptPath: string): Promise<void> {
  const script = `tell application "Terminal"
  activate
  do script ${appleScriptString(shellEscapePath(scriptPath))}
end tell`
  return new Promise((resolve, reject) =>
    execFile('osascript', ['-e', script], (err) =>
      err ? reject(err) : resolve()
    )
  )
}
