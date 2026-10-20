# Coding-agent employees — Philharmonic hands work to the user's own Claude Code (and later Codex) and watches it through

Date: 2026-10-09 · Status: design approved in chat (owner, 2026-10-09: v1's five questions and v2's four answered); ready for an implementation plan
Repo: `actovia` (desktop; the phone waits for Philharmonic on iOS, §9)
Reference: the probes of 2026-10-09 (`claude` 2.1.294, scratchpad `cc-probe/`): stream-json in and out, permission prompts answered by the host, deny, interrupt, resume, partial messages — all verified against the real CLI. Claude's desktop app for the folder picker (owner's screenshot, 2026-10-09): a folder chip — No folder · Recent · Open folder… — beside a branch chip and a worktree toggle.

## 1. Goal

Actovia is not an AI-coding product and will not become one. Philharmonic can still get code written, PDFs sorted, a repo changed: the owner gives a group a task and a folder, the PM plans it, and steps go to **employees that are coding agents** — the Claude Code (later Codex) the owner already installed and logged into, run by Actovia as the human at the keyboard. Actovia shows what each one does step by step, stops for the owner wherever the agent stops, and reports back when it is done. The agent stays itself: its login, its tools, its permission rules, its hooks, skills and MCP servers.

### Decided by the owner (2026-10-09)

| Decision             | Choice                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which route          | Drive the user's installed CLI; no Agent SDK (the SDK may not offer claude.ai login to third parties, only API keys — its overview's note)                  |
| Where                | **Philharmonic only.** Not a Chat tool                                                                                                                      |
| Name                 | "Claude Code" — it is the owner's own install. Each CLI by its own name; Codex next, and several instances of one CLI (different models) side by side       |
| Folders              | An existing folder (a repo, a folder of PDFs) **or** a new project; either way a project folder `~/Actovia Projects/<name>/` exists and holds the meta (§4) |
| Blocking             | A step waits for its agent's turn to end; the PM then sees the result                                                                                       |
| Continue in Terminal | Yes, phase 1                                                                                                                                                |
| Usage, limits, cost  | Reported as the CLI reports them, no special treatment: its rate-limit notices and its cost appear as it gave them                                          |
| Pre-warm             | No (unchanged since 2026-10-08)                                                                                                                             |
| Scope of this pass   | MVP: start, watch, answer, interrupt, continue. Switching modes mid-session, installing skills and the CLIs' other abilities come later                     |

### Non-goals

- A terminal emulator, a PTY, OSC 7501 (stream-json gives everything OSC 7501 would; a TUI view is a later phase).
- Actovia's own coding tools or editor. Actovia never edits the project; the agent does.
- Managing a CLI's configuration (its settings, skills, MCP, login). Actovia checks it is there and logged in, nothing more.
- Approving anything on the owner's behalf (§7).
- A Chat entry point. Chat stays a conversation; work on folders is Philharmonic's.

## 2. The protocol, as verified (Claude Code)

One process per agent session: `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio [--model M] [--permission-mode P] [--resume <cliSessionId>]`, run in the working folder.

| Direction | Line                                                                                                                                   | Meaning for Actovia                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| → stdin   | `{type:'user', message:{role:'user', content}}`                                                                                        | a task, or a follow-up in the same session                           |
| ← stdout  | `system/init` (`session_id`, `model`, `permissionMode`, `tools`)                                                                       | a turn starts; keep `session_id` to resume                           |
| ← stdout  | `stream_event` (`content_block_delta` `text_delta` / `thinking_delta`)                                                                 | text as it is written                                                |
| ← stdout  | `assistant` (`text`, `thinking`, `tool_use{name, input}`), `user` (`tool_result{is_error, content}`)                                   | the steps                                                            |
| ← stdout  | `control_request {request_id, request:{subtype:'can_use_tool', tool_name, input}}`                                                     | **blocked**: a permission, or `AskUserQuestion` (structured options) |
| → stdin   | `control_response {response:{subtype:'success', request_id, response:{behavior:'allow', updatedInput} \| {behavior:'deny', message}}}` | the owner's answer; a deny's `message` reaches the model verbatim    |
| → stdin   | `control_request {request_id, request:{subtype:'interrupt'}}`                                                                          | stop; acknowledged in ~0.1 s                                         |
| ← stdout  | `result {subtype:'success' \| 'error_during_execution' \| …, result, total_cost_usd, duration_ms, permission_denials}`                 | the turn is over (an interrupt ends it `error_during_execution`)     |
| ← stdout  | `rate_limit_event {rate_limit_info}`                                                                                                   | passed through as the CLI's notice                                   |

Observed behaviours the design must hold to:

1. **A `result` is not the end.** A background command the agent started finished 30 s after our last message and the CLI ran a turn of its own, unprompted. Actovia keeps reading for as long as the process lives.
2. After an interrupt the process lives on and the session continues; the model knows it was cut off.
3. `--resume <id>` in a new process continues the same session (same id, full memory). A process can exit between turns at no cost.
4. Read-only work (`ls`) does not prompt; writes do in the default mode. What prompts is the CLI's rule, not Actovia'.
5. The user's own hooks, MCP servers, skills and CLAUDE.md load. Behaviour varies by user; Actovia does not normalise it.
6. Unknown event types and fields appear (`hook_started`, `thinking_tokens`, `status`…). The parser ignores what it does not know.

Codex has its own machine interface (`codex exec --json`, and an app-server protocol); its adapter is written against it when Codex lands, behind the same driver interface (§8). Nothing here is verified for Codex yet.

## 3. Settings › Agents

Two levels: the **CLIs** found on the machine, and the **agents** (employees) made from them.

### CLIs

One row per supported CLI (Claude Code now, Codex next):

```
Claude Code                                          ● Ready
  /Users/…/.local/bin/claude · 2.1.294 · claude.ai (Max)        [Check]  [Change path…]
Codex                                                ● Broken
  /Users/…/.nvm/…/bin/codex — the launcher is there, its binary is missing
  (spawn …/codex-darwin-arm64/…/codex ENOENT). Reinstall Codex.   [Check]  [Change path…]
```

**Check** runs, without using any quota:

| Step      | Claude Code                                           | Result shown                                                                   |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| Found     | the path (override, else login-shell lookup)          | Not installed — with the install command                                       |
| Runs      | `claude --version`                                    | Broken — the error, as on this machine's Codex (a launcher without its binary) |
| Supported | version ≥ the minimum we tested                       | Too old — update                                                               |
| Logged in | `claude auth status` (JSON: `loggedIn`, `authMethod`) | Not logged in — "run `claude` in Terminal and log in"; else the method         |

Ready = all four. The check runs when Settings opens, before any session starts (cached for the app's life, re-run on failure), and from the button. **No "test prompt"** — a real round trip uses the owner's quota and adds nothing the four steps miss; the first real session is the end-to-end test, and its failure is shown as the CLI gave it.

**Finding the binary**: an app launched from Finder has launchd's PATH and does not see `~/.local/bin`, `/opt/homebrew/bin` or nvm's bin. The lookup runs `command -v <cli>` in the owner's login shell (`$SHELL -lic`, once), falls back to the usual install paths, and the path can be set by hand. The child gets the login shell's PATH too (nvm-installed CLIs need node on it).

### Agents (employees)

An employee whose **runtime** is a CLI. The existing `agent` row gains the fields; the persona fields (name, avatar, description, team) stay, the system prompt becomes "instructions prepended to every task", and the tool / skill / MCP allow-lists do not apply (the CLI has its own).

| Field              | Claude Code                                                                 | Note                                                              |
| ------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Runtime            | `claude-code` · `codex` · (`actovia` = today's employees)                   |                                                                   |
| Model              | the CLI's own names (`opus`, `sonnet`, `haiku`, a full id) or "CLI default" | two employees can be the same CLI with different models           |
| Permission mode    | `default` · `acceptEdits` · `auto`                                          | `bypassPermissions` is never offered (§7)                         |
| Extra instructions | text                                                                        | prepended to each task ("you are the reviewer; never edit files") |

The agents are ordinary Philharmonic employees after that: in teams, in group members, chosen by the PM. A new install gets one ready-made employee per Ready CLI ("Claude Code", CLI default model, `default` mode) so there is nothing to set up before the first try.

### Other settings

- **Projects folder** — default `~/Actovia Projects`.
- **At most N agents running at once** (default 2) — the owner's machine and quota; a step over the limit waits, and says so.
- **Keep an agent's process after its turn** — default 10 minutes (§8); 0 = exit at once and resume next time.
- **Worktrees** — default on: when two agents work in the same git repo at once, each gets its own worktree (§4).

## 4. Projects and folders

A Philharmonic group that works on files is bound to a **project**. The group's composer gets the screenshot's chips: a folder chip and, for a git folder, a branch chip with a worktree toggle.

```
[ 🗂 notes-prototype ▾ ]  [ ⑂ main · ☐ worktree ]
     No folder
     ──────────
     Recent
       actovia ✓
       tax-pdfs-2026
     ──────────
     New project…
     Open folder…
```

- **No folder** — today's group: no coding agents can be given steps (the PM is told they are unavailable).
- **New project…** — a name; creates `~/Actovia Projects/<name>/`, and the work happens **in it**.
- **Open folder…** — an existing folder (a repo, a folder of PDFs). The work happens **there**; `~/Actovia Projects/<name>/` is still created, for the meta only — nothing of Actovia's is written into the owner's folder.
- **Recent** — the projects used before, by name.

Every project folder has the same meta, in `.actovia/` (hidden, so a new project's own files read clean):

```
~/Actovia Projects/notes-prototype/
  .actovia/
    project.json        # id, name, workDir (this folder, or the opened one), createdAt, the group's id
    plan.md             # the group's plan (moves here from ~/.actovia/groups/<id>/plan.md)
    sessions/<id>.json  # one per agent session: runtime, model, cliSessionId, cwd, state, timestamps
    logs/<id>.jsonl     # the CLI's raw event lines — for the owner and for debugging; never read back as instructions
  index.html …          # a new project's work; an opened folder's work stays where it is
```

For an opened folder, `project.json`'s `workDir` points at it, and the project folder also gets a Finder alias to it, so the project reads whole in Finder.

**Worktrees**: two agents in the same git repo at once would edit the same files. With the toggle on (or the setting, §3), each agent session after the first gets `git worktree add` under `.actovia/worktrees/<session>/` on a branch `actovia/<session>`; the card shows the branch; merging back is the owner's (or a later step's) job, never automatic. Not a git folder: agents share the folder, and the PM is told to keep their steps apart.

Folder rules (§7): never `~`, `/`, or anything under `~/.actovia`; an opened folder is the owner's pick in a system dialog, so it is consent to work there.

## 5. In the group: the step, the card

The PM delegates a step to a coding-agent employee as to any employee (`createDelegateTaskTool`); `runDelegatedTask` branches on the runtime: `actovia` → `runEmployeeLoop` as today; a CLI → `runAgentEmployee`, same arguments (agent, instructions, executionId, conversationId, emit, signal), same events out (`message_start`, `message_delta`, `tool_card`, `message_end`), same `Promise<string>` back: the agent's final text, the files it touched, denials, interrupted or not, its session id. The PM reads that and goes on. A later step to the same employee in the same project continues its session (`--resume`), so "now add tests" has the context.

The employee's message in the group is a **card**, the steps timeline's look (capital-case tool names):

```
┌ Claude Code (Opus) · notes-prototype · actovia/a1b2 ─────── Working ◌ ┐
│ ✓ Write  index.html                                                  │
│ ✓ Write  app.js                                                      │
│ ◌ Bash   npm install                                                 │
│ "Setting up a minimal Vite project with full-text search…"           │
└─────────── Stop ─────── Open folder ─────── Continue in Terminal ────┘
```

- Header: the employee, the folder, the branch when in a worktree, the state: Working · Waiting for you · Done · Stopped · Failed.
- Steps: each `tool_use` a row (one-line input: the path, the command); its `tool_result` ticks it or marks it failed. Long runs fold to the last few with "N more steps".
- Text streams under the steps; when done, the final text is the card's body (Markdown). The CLI's own notices (rate limit, cost) appear as a quiet line, verbatim.
- **Continue in Terminal** opens Terminal.app in the working folder running `claude --resume <cliSessionId>` — the owner takes over by hand; Actovia marks the session "continued in Terminal" and does not drive it while that terminal could be (it resumes on the next step).
- **Stop** interrupts that agent only; the group's Stop stops the PM and every running agent.

### Waiting for you

A `control_request` puts the card in **Waiting for you**, the task row in `waiting_for_user`, and shows inside the card:

- **A permission** — "Claude Code wants to run `npm install`" / "…to write `app.js`", **Allow** / **Deny**, and "Tell it why (optional)", sent as the deny `message`. No "always allow": that is the CLI's own settings.
- **A question** (`AskUserQuestion`) — the questionnaire block's rows, live, single or multi select per `multiSelect`, an Other field; Submit sends `allow` with `updatedInput.answers`.

Answers go to `POST /api/v1/agents/:sessionId/respond {requestId, answer}`. Today's `askUserRegistry` holds one wait per conversation; several agents can wait at once, so these waits are keyed by `(sessionId, requestId)`, beside it. A notification fires when the window is in the background (`notifyIfBackground`): "Claude Code is waiting for you — npm install".

## 6. Several agents at once

The PM may hand steps to several agents in parallel (the delegate calls of one PM turn run concurrently, up to the running limit, §3). Each has its own process, card, session file and — in a git repo with worktrees on — its own worktree. Two instances of one CLI with different models are two employees ("Claude Code (Opus)" writes, "Claude Code (Haiku)" reviews). Nothing is shared between them but the folder; the PM is the one who passes results along.

## 7. Safety

The agent is the owner's own tool with its own permission system, and Actovia gives it nothing the owner's terminal would not. But the PM writes the task, and Actovia's models read the web — so a poisoned page could become an instruction to an agent. The rules:

1. **Default permission mode is `default`** (the agent asks before writes and commands). `acceptEdits` and `auto` are per employee, set knowingly; `bypassPermissions` is never passed.
2. **Actovia never answers a `control_request` itself.** Every one is the owner's click. No timeout auto-deny: the CLI waits; the card waits.
3. **Folders**: never `~`, `/`, anything under `~/.actovia`; an opened folder is the owner's pick in the system dialog.
4. **The environment is the login shell's, scrubbed**: never Actovia's own variables, provider keys, or the loopback port / token.
5. Actovia's secrets hardening (§2.5 of the 2026-09-25 spec) does not reach inside the agent — its file tools are its own. Settings › Agents says so: "Coding agents run with their own permissions, in the folder you give them."
6. The raw logs (`logs/*.jsonl`) can hold file contents the agent read; they live in the project folder the owner owns, and are never fed back to a model.

## 8. The driver (main process)

`src/main/lib/agents/`:

- `cli-check.ts` — find, run, version, login (§3), per CLI.
- `driver.ts` — the interface every CLI implements:

  ```ts
  interface AgentDriver {
    check(): Promise<CliStatus>
    start(input: {
      cwd: string
      task: string
      model?: string
      permissionMode: PermissionMode
      resume?: string
    }): AgentRun
  }
  interface AgentRun {
    events: AsyncIterable<AgentEvent> // init, step, text, blocked, turn_end, notice, exit
    respond(requestId: string, answer: AgentAnswer): void
    send(text: string): void
    interrupt(): void
  }
  ```

- `claude-code/protocol.ts` — zod schemas for §2's lines, `passthrough`; anything else skipped. Pure; fixtures from the probes.
- `claude-code/run.ts` — spawns, reads NDJSON across chunks (`readline`), writes lines, holds pending `control_request`s, maps to `AgentEvent`s, and the state machine `starting → working ⇄ blocked → done | stopped | error`, `exited` on process exit (an exit while working / blocked is `error` unless we stopped it). Appends every raw line to the session's log.
- `registry.ts` — live runs by session id; the running limit; one process per session; the keep-alive after a turn (§3) catches unprompted turns and makes the next step instant, then the process exits and the next step resumes. App quit: interrupt, SIGTERM, SIGKILL after 3 s; sessions working / blocked become stopped.
- `projects.ts` — create / open / list projects, `project.json`, the alias, worktrees.
- `server/routes/agents.ts` — `GET /clis` (statuses), `POST /clis/:id/check`, `POST /:sessionId/respond`, `POST /:sessionId/interrupt`, `GET /:sessionId/sse`; `server/routes/projects.ts` — list / create / open. Behind the existing auth gate.

Data: the `agent` table gains `runtime`, `cliModel`, `permissionMode`; `conversation` gains `projectId`; a `project` table (id, name, dir, workDir, lastUsedAt) backs Recent; an `agent_session` table (id, projectId, agentId, conversationId, runtime, cliSessionId, cwd, branch, state, timestamps) is the index, and `sessions/<id>.json` its copy in the project for the owner. The card's content is the `conversation_message`'s `parts`, written as the run goes.

### 8.1 Every employee's own model

Today `runEmployeeLoop` calls `getModelFromProvider(setting)` and every Actovia employee runs on the global model; `agent.model` / `agent.provider` are stored and never read. In this pass:

- The employee editor gets a **Model** picker: "Default (the app's model)" or a model of a provider that is configured with a key. For a CLI runtime the same picker lists the CLI's names instead (§3).
- `runEmployeeLoop` resolves `agent.provider` + `agent.model` through the same provider table `getModelFromProvider` uses (a settings copy whose `providerConfig` is the employee's), falling back to the global model when unset — and, when the employee's provider has lost its key or the model is gone, failing the step with that reason instead of silently running on another model.
- The PM keeps the global model.
- The group's member list shows each employee's model beside its name.

## 9. Phases

| Phase | What                                                                                                                                                                                                                                                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Settings › Agents (CLIs + checks, Claude Code employees); every employee's own model (§8.1); projects and the folder chip; the driver for Claude Code; the card with steps / text / permission / question / Stop / Open folder / Continue in Terminal; notifications; parallel agents and worktrees |
| 2     | Codex: its adapter behind `AgentDriver`, its check, its employees                                                                                                                                                                                                                                   |
| 3     | iOS: when Philharmonic comes to the phone (a placeholder today), the card and its answers — "waiting for you" answered from the sofa                                                                                                                                                                |
| later | The CLIs' other abilities: switching mode mid-session, skills, `/commands`; a terminal view (PTY + OSC 7501) for any program that speaks it                                                                                                                                                         |

## 10. Edge cases

- A CLI goes missing or logs out between check and use: the step fails with the CLI's own message and a link to Settings › Agents; the check is re-run.
- The process dies mid-turn: the card shows Failed with stderr's last lines; the next step resumes.
- Two steps for the same session at once: the second waits for the turn (we never interleave).
- The group is deleted while agents run: interrupt and exit; the project folder and the owner's folder are left alone.
- The owner continued in Terminal and a new step comes for that session: the step resumes it; if the terminal is still driving it, the CLI's own conflict message is shown as is.
- A `control_request` subtype we do not know: "Claude Code needs you in a terminal" with Continue in Terminal; never auto-answered.
- An opened folder that is moved or deleted: the project shows "folder missing — locate…".
- Worktree creation fails (dirty index, detached HEAD): fall back to the shared folder and tell the PM.

## 11. Resolved questions (owner, 2026-10-09)

1. Meta in `.actovia/`, hidden — yes.
2. An opened folder's Finder alias in its project folder — yes.
3. Parallel by default, limit 2 — yes.
4. Today's employees' `model` / `provider` — fixed in the same pass (§8.1).

## 12. Testing

- `protocol.ts`, the run's state machine: Vitest against the probe fixtures, including the unprompted turn, the interrupt and the deny.
- The driver end to end against a **fake CLI** (a Node script given as the path, replaying fixture lines and reading stdin), so CI never needs a real CLI or an account. The checks against fake CLIs that are missing, broken (a launcher whose binary is gone), old, logged out.
- Projects: create / open / Recent / the alias / worktree add and fallback, in a temp home.
- Employee models: an employee with its own provider/model runs on it; unset falls back to the global; a provider without a key fails the step with the reason.
- The card: renderer tests with recorded `parts`.
- Manual, real CLI: a new project from an idea; an opened repo with two agents in worktrees; an opened PDF folder; deny with a reason; a question; Stop one agent, then the whole group; quit Actovia mid-run and resume; Continue in Terminal.
