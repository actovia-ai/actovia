# @actovia-ai/agent-guard

An approval gate for an AI agent's tool calls. Run it in your agent loop's
before-tool-call hook. A call that touches a secret on the machine comes
back `ask`: pause it and let the user decide. A call that touches your app's
own secrets or API comes back `refuse`: block it without asking. Anything
else comes back `null`. For Node, with no dependencies.

```ts
import { createGuard } from '@actovia-ai/agent-guard'

const guard = createGuard({
  appName: 'Acme',
  appDirName: '.acme', // ~/.acme
  refused: ['vault.key', 'db'], // under ~/.acme: never handed out
  ownPorts: [8123], // an MCP call aimed here is refused
  tools: {
    paths: { read_file: 'path', write_file: 'path', grep: 'path' },
    recursive: ['grep'], // a tree read also asks when the tree holds a secret
    terminal: 'bash', // { command, cwd? }
    mcpCall: 'call_mcp_tool' // { server, tool, arguments }
  },
  skipDirs: new Set(['node_modules', '.git'])
})

const target = await guard.sensitiveTarget(toolName, args, workspaceDir)
if (target?.kind === 'refuse') return block(guard.refusedReason(target.summary))
if (target?.kind === 'ask' && !(await askUser(target.summary))) {
  return block(guard.declinedReason(target.summary))
}
```

What it asks about:

- **Credential locations:** `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker/config.json`, `~/.netrc`, the npm, PyPI, gem, Maven, git and Vault token files, `~/.config/{gh,gcloud,op,hub,rclone}`, `~/.password-store`, `~/.pgpass`, `~/.my.cnf`, `~/.s3cfg`, `~/.boto`, keyrings and keychains, and the profiles of Chrome, Chromium, Brave, Edge, Firefox, Arc, Vivaldi and Opera.
- **Secret-named files outside the workspace:** `.env*`, `*.pem`, `*.key`, `id_*`, along with their `.bak`, `.old` and `~` copies. `.example`, `.sample`, `.template` and `.dist` files are exempt.
- **Shell commands:** a command that names any of these places, reads the keychain (`security find-*-password`), prints a CLI's token (`gh auth token`, `gcloud auth print-access-token`…), or lists other processes' arguments (`ps -axo args`, `/proc/<pid>/environ`). This is a documented heuristic, not a shell parser.
- **MCP calls:** every string in `arguments` is checked both as a path and as a command.

Paths are compared with `~`, the cwd and symlinks resolved. Each path gets 250 ms to resolve and each call gets 3 s; a path that isn't resolved in time is asked about. A network volume is never touched. Comparison is case-folded on macOS and Windows, and the `/System/Volumes/Data` firmlink is ignored.

The `summary` names a path (with home shown as `~`) or the command, never a file's contents. It is sanitized for display: bidi and format controls are stripped, a line break shows as `⏎` and a tab as `⇥`. It is capped at 8,000 characters, cut from the end so the trigger survives; `truncated` and `hiddenChars` say whether anything was cut. `forModel(summary)` gives the short form for text the model reads.

MIT.
