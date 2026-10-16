# Codex employees — phase 2 of coding-agent employees

Date: 2026-10-10 · Status: design agreed in chat (owner, 2026-10-10); spec for the owner's review
Repo: `exodus`, branch `coding-agents` (worktree `exodus-agents`), on top of phase 1
Reference: phase 1 spec `2026-10-09-coding-agent-employees-design.md` (everything there holds unless this spec says otherwise); the Codex probe of 2026-10-10 (`codex-cli 0.162.1`, ChatGPT login) and the protocol types `codex app-server generate-ts` emits.

## 1. Goal

A Philharmonic employee can be the owner's own Codex, exactly as one can be their own Claude Code: the PM hands it a step, Exodus runs it in the group's folder, shows its steps on the same card, stops for the owner's Allow / Deny / answers, and returns the result. Nothing of phase 1's machinery is duplicated: Codex is a second implementation of the `AgentDriver` the step already runs on.

### Decided by the owner (2026-10-10)

| Decision         | Choice                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| Interface        | `codex app-server` (stdio JSON-RPC) — not `codex exec --json`, which is one-shot and cannot answer an approval        |
| Permission modes | Mapped by meaning (§4); the sandbox is always `workspace-write`, never `danger-full-access`                           |
| Architecture     | A second driver behind `AgentDriver`; `runAgentEmployee`, the registry, the card, projects, routes and UI stay shared |
| Branch           | Continue on `coding-agents`; merged together with phase 1                                                             |

### Non-goals

- `codex exec`, the Codex TypeScript SDK, or Codex Cloud.
- "Allow for the whole session" / exec-policy amendments — Codex offers them; Exodus answers Allow (this request) or Deny only, as in phase 1. Standing rules stay in Codex's own config.
- Managing Codex's config, MCP servers, skills or login.
- iOS (phase 3).

## 2. The protocol, as verified (codex-cli 0.162.1)

One process per agent session: `codex app-server` in the working folder, stdio, newline-delimited JSON-RPC 2.0 **without** the `jsonrpc` field.

| Direction      | Message                                                                                                                                                                                                                                             | Meaning for Exodus                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| → request      | `initialize {clientInfo:{name:'exodus', title:'Exodus', version}, capabilities:null}`                                                                                                                                                               | handshake; then the `initialized` notification                                                                                    |
| → request      | `thread/start {cwd, approvalPolicy, sandbox:'workspace-write', model?}` → `{thread:{id}, model, …}`                                                                                                                                                 | a new session; `thread.id` is the CLI session id                                                                                  |
| → request      | `thread/resume {threadId, cwd, approvalPolicy, sandbox, model?}`                                                                                                                                                                                    | continue a session in a new process (verified: full memory, same id)                                                              |
| → request      | `turn/start {threadId, input:[{type:'text', text, text_elements:[]}]}` → `{turn:{id}}`                                                                                                                                                              | a task or follow-up                                                                                                               |
| → request      | `turn/interrupt {threadId, turnId}`                                                                                                                                                                                                                 | stop; the turn completes with `status:'interrupted'`, the process lives                                                           |
| ← notification | `turn/started`, `turn/completed {turn:{status:'completed'\|'interrupted'\|'failed', error}}`                                                                                                                                                        | turn boundaries                                                                                                                   |
| ← notification | `item/started` / `item/completed {item}` with `item.type` `agentMessage` (text), `commandExecution` (command, cwd, exitCode, status), `fileChange` (changes[{path, kind, diff}], status), `mcpToolCall`, `webSearch`, `reasoning`, `userMessage`, … | steps and text                                                                                                                    |
| ← notification | `item/agentMessage/delta`                                                                                                                                                                                                                           | streamed text                                                                                                                     |
| ← request      | `item/commandExecution/requestApproval {itemId, command, cwd, reason, …}`                                                                                                                                                                           | a command needs the owner                                                                                                         |
| ← request      | `item/fileChange/requestApproval {itemId, reason, grantRoot}`                                                                                                                                                                                       | a file change needs the owner — **the content is on the `fileChange` item announced just before** (`item/started`, same `itemId`) |
| ← request      | `item/permissions/requestApproval {itemId, cwd, reason, permissions:{network, fileSystem}}`                                                                                                                                                         | the agent asks to leave the sandbox                                                                                               |
| ← request      | `item/tool/requestUserInput {itemId, questions:[{id, header, question, isOther, isSecret, options}]}`                                                                                                                                               | a question (experimental in Codex)                                                                                                |
| ← request      | `mcpServer/elicitation/request`                                                                                                                                                                                                                     | an MCP server asks something                                                                                                      |
| → response     | `{id, result:{decision:'accept'\|'decline'}}` (approvals), `{id, result:{permissions, scope:'turn'}}`, `{id, result:{answers:{[qid]:{answers:[…]}}}}`                                                                                               | the owner's answer                                                                                                                |
| ← notification | `serverRequest/resolved`, `thread/status/changed`, `thread/tokenUsage/updated`, `account/rateLimits/updated`, …                                                                                                                                     | ignored except where §3 uses them                                                                                                 |

Behaviours the design must hold to:

1. The first request after `initialize` must wait for its response; requests are matched by id. A server request (has `id` and `method`) must be answered exactly once — or the turn waits forever.
2. File-change approvals carry no content; Exodus correlates by `itemId` with the `fileChange` item it already received. If no such item is known, the prompt says "the change wasn't shown — Deny unless you expected it".
3. A declined change/command ends that item `status:'declined'`; the agent carries on and says so (verified).
4. Under `untrusted` every command and file change asks, except reads Codex deems safe (verified: `ls`, file writes and `sleep` all asked).
5. Unknown notifications and item types are ignored; unknown server requests are answered with a refusal (`decline` / JSON-RPC error) and shown as a notice — never left pending, never accepted.

## 3. The driver (`src/main/lib/agents/codex/`)

- `protocol.ts` (pure, fixture-tested like Claude Code's): maps one inbound JSON-RPC message to `AgentEvent[]` plus, for server requests, a `pending` record `{rpcId, kind, input}`.
  - `thread/start|resume` response → `init {cliSessionId: thread.id, model}`; `turn/started` sets the current turn id (kept in the run).
  - `item/agentMessage/delta` → `text_delta`; `item/completed` agentMessage → `text`.
  - `item/started` of `commandExecution` / `fileChange` / `mcpToolCall` / `webSearch` → `step_start {id: item.id, tool: 'Bash'|'Edit'|<server.tool>|'WebSearch', summary}`; `item/completed` → `step_end {isError: status in ('failed','declined')}`. File-change items are also remembered (path + kind + diff) for rule 2.
  - Approval requests → `blocked` permission prompts with `detail` built like Claude Code's `describeInput`: the full command (and cwd); for file changes every path with its kind and full diff; for permission requests the exact network / file-system grant asked for and the reason; nothing truncated, every unknown field appended.
  - `requestUserInput` → `blocked` question prompt; `isSecret` questions render as a password field (the answer still goes to the agent, the card never stores it).
  - `turn/completed` → `turn_end {ok: status==='completed', interrupted: status==='interrupted', text: the turn's last agentMessage, costUsd: null, denials: count of declined items}`.
  - `account/rateLimits/updated` when a limit is reached → `notice` (verbatim fields, as phase 1).
- `run.ts`: spawns `codex app-server` with the scrubbed login-shell env (phase 1), performs the handshake and `thread/start|resume`, then implements `AgentRun`:
  - `send(text)` → `turn/start`; `interrupt()` → `turn/interrupt` with the current turn id; `respond(requestId, answer)` → the JSON-RPC response for that pending server request (`allow` → `accept` / grant / answers; `deny` → `decline` / empty grant; a deny reason is not supported by Codex's protocol — the card hides the reason field for Codex prompts).
  - Same robustness as phase 1's run: never throws, `exit` after stdout drains (1.5 s cap), log via `openMetaLog`-style O_NOFOLLOW + nlink check, stdin/stdout/stderr error listeners, `stop()` ends stdin then SIGTERM/SIGKILL.
  - A server request arriving while no listener can show it (e.g. between steps) is still turned into `blocked` on the card — the step's message is persisted from step start (phase 1 C1), so it stays answerable.
- `cli-check.ts` (shared) gains Codex: binary `codex`, minimum `0.162.1`, logged-in check `codex login status` (exit 0 and "Logged in"), `authMethod` = the status text ("ChatGPT" / "API key").
- Models: `model/list` on a short-lived app-server during the Check (no quota) fills the employee editor's suggestions; free text still allowed, validated like Claude Code's.
- Continue in Terminal: the phase-1 hand-off script with `exec codex resume <threadId>` in the session's cwd.

## 4. Permission modes for Codex

| Exodus mode                                      | Codex `approvalPolicy` | Sandbox           | Editor text for Codex                                                           |
| ------------------------------------------------ | ---------------------- | ----------------- | ------------------------------------------------------------------------------- |
| Ask before changes (`default`)                   | `untrusted`            | `workspace-write` | "Asks before every command and file change"                                     |
| Edit freely, ask before commands (`acceptEdits`) | `on-request`           | `workspace-write` | "Works freely inside the folder; asks to go beyond it (network, other folders)" |
| Auto (`auto`)                                    | `never`                | `workspace-write` | "Never asks; can only work inside the folder, no network"                       |

`danger-full-access` is never passed (the counterpart of phase 1's "never `bypassPermissions`"). Grants from a permission request are `scope:'turn'` only.

## 5. Data and shared code

- Migration 0017 (0016 on the branch; renumbered at the merge, after `0016_drop_full_text_search`): `agent_runtime` enum gains `'codex'`, `IF NOT EXISTS` for a database that ran the branch's 0016.
- `CLI_IDS = ['claude-code', 'codex']`, `CLI_NAMES.codex = 'Codex'`, `AGENT_RUNTIMES` gains `'codex'`.
- `runAgentEmployee` picks the driver by `agent.runtime` (`claude-code` → `startClaudeCode`, `codex` → `startCodex`) and the CLI status by the same id; everything else is unchanged. The PM roster text names the CLI.
- Default employee: the phase-1 once-only flag becomes per CLI (`defaultEmployeeCreated: Record<CliId, boolean>`), since a Ready Codex should get its own default once.
- Settings › Agents lists both CLIs; the employee editor offers Codex when Ready, with §4's texts and the model suggestions from `model/list`.
- `agent_session.runtime` stores `'codex'`; the card's header names the CLI from `card.runtime`.

## 6. Safety (phase 1 §7 holds; additions)

1. Every Codex server request is answered exactly once by the owner's click, or refused by Exodus for unsupported kinds — never accepted automatically, never left pending.
2. The sandbox is always `workspace-write`; Exodus never grants `session`-scoped permissions.
3. File-change prompts show the full diff from the item; an approval whose content Exodus never saw says so (rule 2).
4. Secret answers (`isSecret`) are never written to the card, the log Exodus keeps, or the DB.

## 7. Edge cases

- Codex not installed / broken / too old / logged out: the phase-1 check states, with Codex's own messages.
- `initialize` or `thread/start` fails (auth expired, config error): the step fails with Codex's error message; the session row keeps no thread id.
- A turn ends `failed`: the card shows Failed with `turn.error`.
- Two approvals pending at once (zsh-bridge subcommands carry `approvalId`): both prompts show; each answers its own request id.
- Codex asks via MCP elicitation: refused + notice "Codex asked something Exodus can't answer — Continue in Terminal".

## 8. Testing

- Fixtures from the 2026-10-10 probe (sanitised): allow, decline, interrupt, resume — committed under `tests/fixtures/codex/`.
- A fake `codex app-server` (Node) that answers `initialize` / `thread/start|resume` / `turn/start` / `turn/interrupt` from the fixtures, pauses on server requests until answered, and records what Exodus sent.
- Protocol, run, and runAgentEmployee-with-codex tests mirroring phase 1's; the check against fake `codex` binaries (missing, broken, old, logged out).
- Manual (owner): a Codex employee builds a file in a new project; Deny a change; Stop mid-command; Continue in Terminal; each permission mode's behaviour; a Claude Code and a Codex employee working in parallel in one repo (worktrees).
