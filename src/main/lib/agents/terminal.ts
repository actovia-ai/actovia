import { execFile } from 'child_process'

export const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
export const appleScriptString = (s: string) =>
  `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
export const terminalCommand = (
  cwd: string,
  binPath: string,
  cliSessionId: string
) =>
  `cd ${shellQuote(cwd)} && ${shellQuote(binPath)} --resume ${shellQuote(cliSessionId)}`

/** Spec §5: the owner takes the session over by hand, in Terminal.app. */
export function openInTerminal(
  cwd: string,
  binPath: string,
  cliSessionId: string
): Promise<void> {
  const script = `tell application "Terminal"
  activate
  do script ${appleScriptString(terminalCommand(cwd, binPath, cliSessionId))}
end tell`
  return new Promise((resolve, reject) =>
    execFile('osascript', ['-e', script], (err) =>
      err ? reject(err) : resolve()
    )
  )
}
