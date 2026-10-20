# Computer Use V0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A window-scoped, screenshot-loop computer-use agent for Actovia — the AI can play `Chess.app` or work through a simple web page, driven by Claude, with a human-motor action space.

**Architecture:** A `computerUse` calling-tool runs a **blocking** perceive→act session. `src/main/lib/computer/` is the Runtime (capture · target-window resolution · "hands" motor primitives · guard) and `src/main/lib/ai/computer-use/` is the inner-loop agent. A bundled Swift helper (`actovia-input`) does the actual screen capture and `CGEvent` posting. Every episode is one trace. All model touch points go through a `ComputerAgent` interface so a local model can be added later without touching the Runtime.

**Tech Stack:** TypeScript, Electron 42 main, Swift 6 (`~/.swiftly/bin/swiftc` present), `@mariozechner/pi-ai` `complete()` with tools, Electron `nativeImage` (downscaling — no new dep), `globalShortcut`, Vitest, Playwright, React 19 + SWR.

**Spec:** `docs/superpowers/specs/2026-09-06-computer-use-v0-design.md` — read it alongside this plan. Research context: `docs/computer-use-research.md`.

## Global Constraints

- **Human motor primitives only.** Action space: `moveMouse / mouseDown / mouseUp / wheel / keyDown / keyUp` + atoms `click / type / drag / hotkey` that **decompose to those**. No `scrollToElement`, no `fill(selector)`, no semantic actions.
- **Window-scoped.** Coordinates the Agent emits are window-relative `(0,0)` = window top-left. The guard clamps to `[0,0,w,h]`; a point > 16px outside → `OutOfBounds` throw, not silent clamp.
- **Screenshot-only perception.** No DOM, no accessibility tree in V0.
- **Model-swappable.** Every LLM call goes through `interface ComputerAgent { nextAction(state, history): Promise<Action> }`. V0 ships `ClaudeComputerAgent` only; `settings.computerUse.model` enum is `['claude']`.
- **Inner loop gets motor tools only** — no `bash`, no `text_editor`, no filesystem.
- **`macOS only`.** The Swift helper and all coordinate/capture logic assume macOS. No Windows/Linux input path.
- **New dependency budget: zero npm deps.** Downscaling uses Electron `nativeImage`. The Swift helper is a build artifact, not an npm package.
- **No `--no-verify`** except the CLAUDE.md-documented flaky PGlite WASM teardown (all test _cases_ passing).
- **DB migration**: single squashed `0000` regenerated on schema change (delete SQL + snapshot, reset `_journal.json` to `{"version":"7","dialect":"postgresql","entries":[]}`, `pnpm db:generate`).
- **Test-ids** are a durable contract — new ids only, `data-testid` in source + a Playwright reference (`test-ids.linkage.test.ts`).
- Commit on `dev`. No push, no `master` merge.
- Trace: `runComputerSession` runs in `withTrace()`; add `'computer'` to `KnownLogSurface`.

## Pre-existing scaffolding (do not recreate)

- `SettingsLabel.ComputerUse = 'Computer Use'` and its menu entry (`MousePointer2Icon`) already exist in `settings-menu.ts`.
- `settings-form.tsx:132` renders `{activeTitle === SettingsLabel.ComputerUse && <UnderConstruction />}` — **replace** this with the real page in Task 12.

---

## File Structure

**New — Swift:** `helper-src/actovia-input/main.swift` (+ any split files) · committed binary `resources/bin/actovia-input`

**New — Runtime (`src/main/lib/computer/`):** `types.ts` · `helper.ts` · `guard.ts` · `hands.ts` · `capture.ts` · `target.ts` · `ask-registry.ts` · `session.ts` · `liveness.ts`

**New — inner agent (`src/main/lib/ai/computer-use/`):** `action-tools.ts` · `system-prompt.ts` · `agent.ts`

**New — glue:** `src/main/lib/ai/calling-tools/computer-use.ts` · `src/main/lib/server/routes/computer-use.ts` · `src/renderer/services/computer-use.ts` · `src/renderer/components/settings/settings-form/computer-use.tsx` · a `ComputerUseCard` in `messages-calling-tools.tsx`

**Modified:** `calling-tools/index.ts` · `ai/utils/tool-binding-util.ts` · `server/app.ts` · `shared/schemas/settings-schema.ts` · `db/schema.ts` · `resources/drizzle/*` · `logger/index.ts` · `settings-form.tsx` · `shared/constants/test-ids.ts` · `messages-calling-tools.tsx` · `package.json` (build script) · `CLAUDE.md`

**Tests:** `tests/unit/main/lib/computer/{guard,hands,capture,target,session}.test.ts` · `tests/unit/main/lib/ai/computer-use/{agent,message-trim}.test.ts` · `tests/unit/main/lib/computer/ask-registry.test.ts` · `tests/e2e/settings-computer-use.spec.ts`

---

## Task 1: The Swift input helper

**Files:**

- Create: `helper-src/actovia-input/main.swift`
- Create: `resources/bin/actovia-input` (built artifact, committed)
- Modify: `package.json` (add `build:helper` script; call it from `build:mac`)
- Test: manual — `resources/bin/actovia-input list-windows`

**Interfaces:**

- Produces (CLI contract consumed by `helper.ts` in Task 2):
  - `actovia-input list-windows` → stdout JSON `[{ "id": number, "app": string, "bundleId": string, "title": string, "bounds": [x,y,w,h] }]` (on-screen windows, window layer 0, excluding Actovia itself)
  - `actovia-input screenshot --window <id>` → PNG bytes on stdout, exit 1 + stderr message if the window is gone
  - `actovia-input input [--clamp x,y,w,h]` → reads newline-delimited JSON commands on stdin, one per line: `{"op":"move","x":N,"y":N}` · `{"op":"down","button":"left|right|middle"}` · `{"op":"up","button":...}` · `{"op":"wheel","dx":N,"dy":N}` · `{"op":"key","code":N,"down":true|false}`. Executes each immediately. `--clamp` restricts `move` points to the rect.

- [ ] **Step 1: Write `main.swift`**

A single-file CLI. Use `CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID)` for `list-windows`; `CGWindowListCreateImage` (or `SCScreenshotManager` if targeting macOS 14+ cleanly) for `screenshot`; `CGEvent(mouseEventSource:mouseType:mouseCursorPosition:mouseButton:)` + `CGEvent(keyboardEventSource:virtualKey:keyDown:)` + `CGEvent(scrollWheelEvent2Source:units:wheelCount:wheel1:...)` for `input`, each `.post(tap: .cghidEventTap)`. Parse args with a tiny switch; parse stdin JSON with `JSONSerialization`. `bounds` from the window dict's `kCGWindowBounds`.

- [ ] **Step 2: Build**

```bash
mkdir -p resources/bin
swiftc -O -o /tmp/actovia-input-arm64 helper-src/actovia-input/main.swift -target arm64-apple-macos13
# x86_64 slice only if an Intel SDK is available; otherwise ship arm64 and note it
lipo -create -output resources/bin/actovia-input /tmp/actovia-input-arm64 || cp /tmp/actovia-input-arm64 resources/bin/actovia-input
chmod +x resources/bin/actovia-input
```

Add to `package.json`:

```json
"build:helper": "swiftc -O -o resources/bin/actovia-input helper-src/actovia-input/main.swift"
```

and prepend `pnpm build:helper && ` to `build:mac`.

- [ ] **Step 3: Smoke test**

Run: `resources/bin/actovia-input list-windows | head -c 400`
Expected: JSON array with at least one entry that has `id`, `app`, `bounds`. (`screenshot` / `input` need TCC grants — the user grants Screen Recording + Accessibility on first real use; note this in the task report, do not block on it.)

- [ ] **Step 4: Commit**

```bash
git add helper-src/ resources/bin/actovia-input package.json
git commit -m "feat(computer): actovia-input Swift helper (list-windows, screenshot, input)"
```

---

## Task 2: Runtime types + helper client

**Files:**

- Create: `src/main/lib/computer/types.ts`, `src/main/lib/computer/helper.ts`
- Test: `tests/unit/main/lib/computer/helper.test.ts`

**Interfaces:**

- Consumes: the CLI contract from Task 1.
- Produces:
  - all types from spec §2.1 verbatim: `MouseButton`, `Action`, `TargetWindow`, `ComputerState`, `SessionOutcome`, `SessionResult`
  - `type HelperCommand = { op:'move'; x:number; y:number } | { op:'down'|'up'; button:MouseButton } | { op:'wheel'; dx:number; dy:number } | { op:'key'; code:number; down:boolean }`
  - `interface InputHelper { listWindows(): Promise<TargetWindow[]>; screenshot(cgWindowId:number): Promise<Buffer>; send(commands: HelperCommand[], clamp?: [number,number,number,number]): Promise<void> }`
  - `const realHelper: InputHelper` — spawns `resources/bin/actovia-input` (resolve via `app.getAppPath()` in prod, `process.cwd()` in dev)
  - `function getHelper(): InputHelper` — returns `mockHelper` when `process.env.ACTOVIA_INPUT_MOCK` is set, else `realHelper`
  - `mockHelper` (exported for tests): records `send()` calls in `mockHelper.sent`, `listWindows()`/`screenshot()` return canned values settable via `mockHelper.__setWindows(...)` / `mockHelper.__setScreenshot(buf)`

- [ ] **Step 1: Write the failing test** — `helper.test.ts`: `mockHelper.send([{op:'move',x:1,y:2}])` records to `mockHelper.sent`; `getHelper()` returns `mockHelper` under `ACTOVIA_INPUT_MOCK=1`; serialization: `realHelper` would write `'{"op":"move","x":1,"y":2}\n'` (test a private `serialize(commands)` export).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `types.ts` (copy §2.1) then `helper.ts` (`child_process.spawn`, write newline-JSON to stdin, collect stdout; `serialize()` pure helper).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Gate + commit** — `git commit -m "feat(computer): Runtime types + actovia-input client (+ mock)"`

---

## Task 3: The guard

**Files:**

- Create: `src/main/lib/computer/guard.ts`
- Test: `tests/unit/main/lib/computer/guard.test.ts`

**Interfaces:**

- Consumes: `Action` (Task 2).
- Produces: `class Guard` per spec §2.5 —
  - `abort(reason: 'hotkey' | 'user' | 'system'): void`
  - `check(action: Action, viewport: { width: number; height: number }): Action` — returns the action with every point clamped to `[0,0,w,h]`; throws `AbortedByUser` if aborted; throws `OutOfBounds` if an original point was > `CLAMP_SLACK` (16) px outside
  - `noteFrame(hash: string): 'ok' | 'stuck'` — `'stuck'` when the last `STUCK_LIMIT` (4) hashes are identical
  - `get aborted(): boolean`
  - export `class AbortedByUser extends Error`, `class OutOfBounds extends Error`

- [ ] **Step 1: Write the failing test**

```ts
import { Guard, AbortedByUser, OutOfBounds } from '@main/lib/computer/guard'
import { describe, expect, it } from 'vitest'

const vp = { width: 800, height: 600 }

describe('Guard.check', () => {
  it('clamps a slightly-out point', () => {
    const g = new Guard()
    const out = g.check({ kind: 'click', to: [810, 600] }, vp)
    expect(out).toMatchObject({ kind: 'click', to: [800, 600] })
  })
  it('rejects a wildly-out point', () => {
    const g = new Guard()
    expect(() => g.check({ kind: 'click', to: [2000, 50] }, vp)).toThrow(
      OutOfBounds
    )
  })
  it('throws once aborted', () => {
    const g = new Guard()
    g.abort('user')
    expect(() => g.check({ kind: 'wait', ms: 10 }, vp)).toThrow(AbortedByUser)
  })
  it('clamps both points of a drag', () => {
    const g = new Guard()
    const out = g.check({ kind: 'drag', from: [-3, 10], to: [10, 610] }, vp)
    expect(out).toMatchObject({ from: [0, 10], to: [10, 600] })
  })
})

describe('Guard.noteFrame', () => {
  it('reports stuck after 4 identical frames', () => {
    const g = new Guard()
    expect(g.noteFrame('a')).toBe('ok')
    expect(g.noteFrame('a')).toBe('ok')
    expect(g.noteFrame('a')).toBe('ok')
    expect(g.noteFrame('a')).toBe('stuck')
    expect(g.noteFrame('b')).toBe('ok')
  })
})
```

- [ ] **Step 2–4: fail → implement → pass.** `check` handles the point-bearing action kinds (`moveMouse.to`, `click.to`, `drag.from/to`); non-point actions pass through (still honouring the abort check).
- [ ] **Step 5: Gate + commit** — `"feat(computer): guard — coordinate clamp, abort, stuck detection"`

---

## Task 4: The hands

**Files:**

- Create: `src/main/lib/computer/hands.ts`
- Test: `tests/unit/main/lib/computer/hands.test.ts`

**Interfaces:**

- Consumes: `Action`, `HelperCommand`, `InputHelper`, `TargetWindow` (Task 2); `Guard` (Task 3).
- Produces: `async function execute(action: Action, ctx: { target: TargetWindow; scaleFactor: number; helper: InputHelper }): Promise<void>` — decomposes per spec §2.4, maps window-relative → screen coords (`screenX = target.bounds[0] + x / scaleFactor`), sends `HelperCommand[]` in one `helper.send(cmds, clamp)` call where `clamp = target.bounds`. `wait` sleeps. `askHuman` / `done` throw `Error('not an executable action')` (the session handles them).
- Also export the pure `function decompose(action: Action, scaleFactor: number, origin: [number, number]): HelperCommand[]` for the test.
- `hotkey` combo parsing: `"cmd+shift+c"` → modifier keydowns in order, key down+up, modifier keyups reversed. Key-name → macOS virtual keycode map (a `KEYCODES` record; cover letters, digits, `cmd/shift/alt/ctrl`, `return/tab/escape/space/delete`, arrows).

- [ ] **Step 1: Write the failing test** — assert `decompose`:
  - `click{to:[100,50]}` (scale 1, origin [0,38]) → `[{op:'move',x:100,y:88}, {op:'down',button:'left'}, {op:'up',button:'left'}]`
  - `type{text:'hi'}` → `[{op:'key',code:KC.h,down:true},{op:'key',code:KC.h,down:false},{op:'key',code:KC.i,down:true},{op:'key',code:KC.i,down:false}]`
  - `drag{from,to}` → move, down, move, up
  - `hotkey{combo:'cmd+c'}` → `[{op:'key',code:KC.cmd,down:true},{op:'key',code:KC.c,down:true},{op:'key',code:KC.c,down:false},{op:'key',code:KC.cmd,down:false}]`
  - scale 2, origin [0,0]: `click{to:[100,50]}` → move to `(50,25)`
- [ ] **Step 2–4: fail → implement → pass.** (`moveMouse` path interpolation — for the test, `decompose(moveMouse)` may emit a single terminal `move`; the eased multi-point path is an `execute`-time detail, keep it out of the pure `decompose` or test only the endpoint.)
- [ ] **Step 5: Gate + commit** — `"feat(computer): hands — atom→primitive decomposition + coord mapping"`

---

## Task 5: Capture + downscale

**Files:**

- Create: `src/main/lib/computer/capture.ts`
- Test: `tests/unit/main/lib/computer/capture.test.ts`

**Interfaces:**

- Consumes: `InputHelper`, `TargetWindow` (Task 2).
- Produces:
  - `async function screenshotWindow(t: TargetWindow, helper: InputHelper): Promise<{ shot: ComputerState['screenshot']; scaleFactor: number }>` — `helper.screenshot(t.cgWindowId)` → `nativeImage.createFromBuffer(buf)`; if longer side > `MAX_EDGE` (1400) resize to fit, `scaleFactor = resizedLongEdge / originalLongEdge`; else `scaleFactor = 1`. `shot = { data: img.toPNG().toString('base64'), mimeType: 'image/png', width, height }`.
  - `function hashPng(base64: string): string` — cheap FNV-1a of the base64, for `Guard.noteFrame`.

- [ ] **Step 1: Write the failing test** — build a fixture PNG with `nativeImage` in the test (`nativeImage.createEmpty()` won't have size; instead create from a known data URL or a committed `tests/fixtures/computer/win-2800.png`). Assert: a 2800-wide input → output width 1400, `scaleFactor` 0.5; a 1000-wide input → unchanged, `scaleFactor` 1; `hashPng` is stable and differs for different input.
- [ ] **Step 2–4: fail → implement → pass.** Mock `electron` (`nativeImage` is real from the `electron` package — in a vitest node env `require('electron')` gives the mock, so either (a) `vi.mock('electron')` with a minimal `nativeImage` that does the resize math via a tiny pure helper you factor out, or (b) test only the pure `computeScale(w,h)` + `hashPng` functions and leave the `nativeImage` glue untested). **Prefer (b)** — factor `computeScale(width, height): { width: number; height: number; scaleFactor: number }` and test that + `hashPng`.
- [ ] **Step 5: Gate + commit** — `"feat(computer): window capture + downscale to ≤1400px"`

---

## Task 6: Target-window resolution

**Files:**

- Create: `src/main/lib/computer/target.ts`
- Test: `tests/unit/main/lib/computer/target.test.ts`

**Interfaces:**

- Consumes: `InputHelper`, `TargetWindow` (Task 2).
- Produces:
  - `async function resolveTarget(appQuery: string, helper: InputHelper): Promise<TargetWindow>` — `helper.listWindows()`, pick the first whose `app` or `bundleId` `includes(appQuery)` case-insensitively; among ties prefer a non-empty `title` and larger area. Throws `TargetNotFound(appQuery)`.
  - `async function refreshBounds(t: TargetWindow, helper: InputHelper): Promise<TargetWindow>` — re-`listWindows`, find by `cgWindowId`; throws `WindowGone` if absent; returns `t` with updated `bounds`/`title`.
  - export `class TargetNotFound extends Error`, `class WindowGone extends Error`

- [ ] **Step 1–4: TDD** with `mockHelper.__setWindows([...])`: match by app substring; match by bundleId; tie-break by area; `TargetNotFound` when nothing matches; `refreshBounds` updates bounds; `WindowGone` when the id vanished.
- [ ] **Step 5: Gate + commit** — `"feat(computer): target-window resolution + bounds refresh"`

---

## Task 7: Ask-registry + the inner agent

**Files:**

- Create: `src/main/lib/computer/ask-registry.ts`, `src/main/lib/ai/computer-use/action-tools.ts`, `src/main/lib/ai/computer-use/system-prompt.ts`, `src/main/lib/ai/computer-use/agent.ts`
- Test: `tests/unit/main/lib/computer/ask-registry.test.ts`, `tests/unit/main/lib/ai/computer-use/agent.test.ts`

**Interfaces:**

- Consumes: `Action`, `ComputerState` (Task 2); `complete` + `Type` from `@mariozechner/pi-ai`; `resolveModel` / the provider config.
- Produces:
  - `ask-registry.ts`: `computerAskRegistry` with `wait(sessionId): Promise<string>`, `has(sessionId): boolean`, `resolve(sessionId, answer): void` — copy `src/main/lib/ai/philharmonic/ask-user-registry.ts` shape, keyed by session id.
  - `action-tools.ts`: `export const ACTION_TOOLS: Tool[]` — one entry per inner action (`moveMouse, mouseDown, mouseUp, wheel, keyDown, keyUp, click, type, drag, hotkey, wait, askHuman, done`), each `{ name, description, parameters: Type.Object({...}) }`. Plus `function toolCallToAction(name: string, args: Record<string, unknown>): Action` (maps + validates; throws on unknown).
  - `system-prompt.ts`: `function computerSystemPrompt(opts: { task: string; width: number; height: number }): string` — the full prompt from spec §3.4.
  - `agent.ts`:
    - `interface ComputerAgent { nextAction(state: ComputerState): Promise<Action> }`
    - `class ClaudeComputerAgent implements ComputerAgent` — ctor `(opts: { task: string; model: Model; apiKey: string })`; owns `private messages: Message[]`; `nextAction(state)`:
      1. push a tool-result-style user message carrying `{type:'image', data: state.screenshot.data, mimeType:'image/png'}` + a text line `step ${state.step} · cursor ${state.cursor}`
      2. `trimImages(this.messages, 3)` — keep only the last 3 messages' image blocks; replace older image blocks with `{type:'text', text:'[screenshot from step N — omitted]'}`
      3. `const res = await complete(model, { systemPrompt, messages: this.messages, tools: ACTION_TOOLS }, { apiKey })`
      4. push `res` (the assistant message) to `this.messages`
      5. find the `toolCall` block; `return toolCallToAction(tc.name, tc.arguments)`. If no tool call → `return { kind:'done', success:false, summary:'model produced no action' }`
    - export the pure `function trimImages(messages: Message[], keep: number): Message[]`

- [ ] **Step 1: Write the failing tests**
  - `ask-registry.test.ts`: `wait` resolves on `resolve`; `has` reflects state; resolving an unknown id is a no-op.
  - `agent.test.ts`:
    - `toolCallToAction('click', { to: [1,2] })` → `{ kind:'click', to:[1,2] }`; `toolCallToAction('done', { success:true, summary:'x' })` → done; unknown name throws.
    - `trimImages`: given 6 messages each with one image block, the result keeps images on messages 4–6 only; 1–3 have `[screenshot from step N — omitted]` text.
- [ ] **Step 2–4: fail → implement → pass.** For `ClaudeComputerAgent.nextAction` itself, do **not** unit-test the `complete()` call (network) — cover it via the scripted-agent path in Task 8. Test only `trimImages` + `toolCallToAction` here.
- [ ] **Step 5: Gate + commit** — `"feat(computer): inner-loop agent — action tools, Claude agent, screenshot trim"`

---

## Task 8: The session loop

**Files:**

- Create: `src/main/lib/computer/session.ts`
- Test: `tests/unit/main/lib/computer/session.test.ts`

**Interfaces:**

- Consumes: everything above; `withTrace` / `bindTraceAttributes` from `@main/lib/logger/trace-context`; `logger`.
- Produces:
  - `async function runComputerSession(opts: { sessionId: string; task: string; target: string; agent: ComputerAgent; helper?: InputHelper; guard?: Guard; maxSteps?: number; settleMs?: number; askHumanTimeoutMs?: number; signal?: AbortSignal; onUpdate?: (u: SessionUpdate) => void }): Promise<SessionResult>`
  - `interface SessionUpdate { step: number; action?: Action['kind']; thumbnail?: string; awaitingHuman?: { question: string }; outcome?: SessionOutcome }`
  - The loop (spec §1 diagram): `withTrace()` → `resolveTarget` → for `step` in `1..maxSteps`: check `signal?.aborted`/`guard.aborted`; `refreshBounds`; `screenshotWindow` → `{shot, scaleFactor}`; `guard.noteFrame(hashPng(...))` → on `'stuck'` inject one `askHuman`, second stuck → `outcome:'stuck'`; build `ComputerState`; `action = await agent.nextAction(state)`; if `done` → return; if `askHuman` → `onUpdate({awaitingHuman})` + `Promise.race([computerAskRegistry.wait(id), timeout])`, feed the answer back as the next state's text (or `outcome:'abandoned'` on timeout); else `guard.check(action, viewport)` then `hands.execute(action, {target, scaleFactor, helper})`; `await sleep(settleMs)`; `onUpdate({step, action: action.kind, thumbnail: shot.data})`. After the loop without `done` → `outcome:'failed'`.
  - Catch `AbortedByUser` → `outcome:'aborted'`; `WindowGone`/`TargetNotFound` → `outcome:'failed'` with the message in `summary`.

- [ ] **Step 1: Write the failing test** — a `ScriptedAgent implements ComputerAgent` (returns a queued `Action[]`), `mockHelper` with `__setWindows`/`__setScreenshot`, `ACTOVIA_INPUT_MOCK=1`:
  - happy path: `[click, type, done(success:true)]` → `outcome:'success'`, `steps:3`, `mockHelper.sent` has the click + type commands.
  - cap: an agent that always returns `wait` → after `maxSteps:5` → `outcome:'failed'`.
  - abort: `guard.abort('user')` after 2 steps (via an `onUpdate` hook) → `outcome:'aborted'`.
  - askHuman: agent returns `askHuman` → session calls `onUpdate({awaitingHuman})`; test resolves `computerAskRegistry.resolve(id,'go')`; agent's next action `done` → `outcome:'success'`.
  - stuck: `mockHelper` returns the same screenshot every time, agent returns `click` each step → after 4 identical frames an `askHuman` is emitted.
- [ ] **Step 2–4: fail → implement → pass.**
- [ ] **Step 5: Gate + commit** — `"feat(computer): the perceive→act session loop"`

---

## Task 9: The `computerUse` calling-tool

**Files:**

- Create: `src/main/lib/ai/calling-tools/computer-use.ts`
- Modify: `src/main/lib/ai/calling-tools/index.ts`, `src/main/lib/ai/utils/tool-binding-util.ts`
- Test: `tests/unit/main/lib/ai/calling-tools/computer-use.test.ts`

**Interfaces:**

- Consumes: `runComputerSession` (Task 8); `getSettings`; `getModelFromProvider`; `AgentTool` / `Type`.
- Produces: `export const computerUse: AgentTool<typeof schema>` —
  - `schema = Type.Object({ task: Type.String({description:'What to accomplish in the target window'}), target: Type.String({description:'App name or bundle id of the window to control'}) })`
  - `execute(toolCallId, { task, target }, signal, onUpdate)`:
    1. `const s = await getSettings()`; if `!s.computerUse?.enabled` → return `{ content:[{type:'text',text:'Computer Use is disabled in settings.'}], details:{error:'disabled'} }`
    2. allowlist: if `!(s.computerUse.targetAllowlist ?? []).some(a => target.toLowerCase().includes(a.toLowerCase()))` → return `{ ...text: 'Target "'+target+'" is not on the allowlist.' , details:{error:'not-allowed'} }`
    3. `const { chatModel, apiKey } = getModelFromProvider(s)`; `const agent = new ClaudeComputerAgent({ task, model: chatModel, apiKey })`
    4. `const sessionId = uuidV4()`; register with `liveness` (Task 10); `try { result = await runComputerSession({ sessionId, task, target, agent, maxSteps: s.computerUse.maxSteps ?? 25, settleMs: s.computerUse.settleMs ?? 800, askHumanTimeoutMs: s.computerUse.askHumanTimeoutMs ?? 300000, signal, onUpdate: u => onUpdate?.({ content:[{type:'text',text:JSON.stringify(u)}], details: u }) }) } finally { liveness.end(sessionId) }`
    5. return `{ content: [{type:'text',text: result.summary}, ...(result.finalScreenshot ? [{type:'image' as const, data: result.finalScreenshot.data, mimeType:'image/png' as const}] : [])], details: { sessionId, outcome: result.outcome, steps: result.steps } }`
  - `index.ts`: import + re-export `computerUse`.
  - `tool-binding-util.ts`: `if (setting.computerUse?.enabled && enabled('computerUse')) tools.push(computerUse)` (match the existing conditional-push style; check what `enabled(...)` / the `AdvancedTools` gate looks like there and follow it).

- [ ] **Step 1: Write the failing test** — mock `getSettings` (`{ computerUse: { enabled:false } }` → disabled text; `{ enabled:true, targetAllowlist:['Chess'] }` + `target:'Safari'` → not-allowed text; `enabled:true` + allowed + a mocked `runComputerSession` resolving `{outcome:'success',summary:'done',steps:2}` → result text `'done'` + `details.outcome==='success'`). Mock `runComputerSession` and `getModelFromProvider`.
- [ ] **Step 2–4: fail → implement → pass.**
- [ ] **Step 5: Gate + commit** — `"feat(computer): computerUse calling-tool + binding gate"`

---

## Task 10: Route + global abort shortcut + liveness

**Files:**

- Create: `src/main/lib/computer/liveness.ts`, `src/main/lib/server/routes/computer-use.ts`
- Modify: `src/main/lib/server/app.ts`
- Test: `tests/unit/main/lib/computer/liveness.test.ts`

**Interfaces:**

- Produces:
  - `liveness.ts`: `const liveness = { start(sessionId, guard): void; end(sessionId): void; abortAll(reason): void; get count(): number }`. On `start` when `count` goes 0→1: `globalShortcut.register('Alt+Shift+Escape', () => liveness.abortAll('hotkey'))`. On `end` when `count` goes 1→0: `globalShortcut.unregister('Alt+Shift+Escape')`. `abortAll` calls `guard.abort(reason)` on every registered guard. Guard against `globalShortcut` being unavailable in tests (`try/catch`, or mock `electron`).
  - `routes/computer-use.ts`:
    - `POST /api/computer-use/abort` → `liveness.abortAll('user')` → `{ ok: true }`
    - `POST /api/computer-use/answer` `{ sessionId, answer }` → `computerAskRegistry.resolve(sessionId, answer)` → `{ ok: true }`
  - `app.ts`: `app.route('/api/computer-use', computerUseRouter)`.
  - `session.ts` (Task 8) already accepts a `guard` — Task 9's tool passes a fresh `Guard` and registers it via `liveness.start(sessionId, guard)`.

- [ ] **Step 1: Write the failing test** — `liveness.test.ts` (mock `electron` `globalShortcut` as `{ register: vi.fn(), unregister: vi.fn() }`): `start` twice + `end` once → `count` 1, `register` called once; `end` again → `unregister` called; `abortAll` calls `.abort` on each guard.
- [ ] **Step 2–4: fail → implement → pass.**
- [ ] **Step 5: Gate + commit** — `"feat(computer): /api/computer-use routes + global abort hotkey"`

---

## Task 11: Settings schema + DB column + logger surface

**Files:**

- Modify: `src/shared/schemas/settings-schema.ts`, `src/main/lib/db/schema.ts`, `src/main/lib/logger/index.ts` (or wherever `KnownLogSurface` lives — `record.ts` per the logging spec; check), `resources/drizzle/*` (regen)
- Test: `tests/unit/main/lib/db/schema-computer-use.test.ts`

**Interfaces:**

- `settings-schema.ts`: add (near `KnowledgeBaseSchema`):

```ts
export const ComputerUseSchema = z.object({
  enabled: z.boolean().default(false),
  targetAllowlist: z.array(z.string()).default([]),
  model: z.enum(['claude']).default('claude'),
  maxSteps: formNumber(z.number().gte(1).lte(100)).nullish(),
  settleMs: formNumber(z.number().gte(100).lte(5000)).nullish(),
  askHumanTimeoutMs: formNumber(z.number().gte(10_000).lte(1_800_000)).nullish()
})
```

and `SettingsSchema` gains `computerUse: ComputerUseSchema.nullish()`.

- `db/schema.ts`: `computerUse: jsonb('computerUse').$type<z.infer<typeof ComputerUseSchema>>()` on the `settings` table.
- `KnownLogSurface`: add `'computer'`.

- [ ] **Step 1: failing test** — `schema-computer-use.test.ts`: `ComputerUseSchema.parse({})` yields `enabled:false, targetAllowlist:[], model:'claude'`; `SettingsSchema` accepts a `computerUse` block.
- [ ] **Step 2–3: implement.**
- [ ] **Step 4: regenerate the migration** — delete `resources/drizzle/0000_*.sql` + `meta/0000_snapshot.json`, reset `meta/_journal.json` to `{"version":"7","dialect":"postgresql","entries":[]}`, `pnpm db:generate`, `pnpm format`.
- [ ] **Step 5: Gate + commit** — `"feat(computer): settings schema + computerUse column + logger surface"`

---

## Task 12: Settings → Computer Use page

**Files:**

- Create: `src/renderer/components/settings/settings-form/computer-use.tsx`, `src/renderer/services/computer-use.ts`
- Modify: `src/renderer/components/settings/settings-form.tsx` (replace `<UnderConstruction />`), `src/shared/constants/test-ids.ts`
- Test: `tests/e2e/settings-computer-use.spec.ts`

**Interfaces:**

- `test-ids.ts`: `computerUse: { enableToggle: 'computer-use.enable-toggle', allowlistInput: 'computer-use.allowlist-input', addTargetButton: 'computer-use.add-target-button' }`
- `computer-use.tsx`: `export function ComputerUse({ form }: { form: UseFormReturnType })` — an `Alert` (copy: _"Computer Use lets the AI operate one window on your Mac with a virtual mouse and keyboard — it sees a screenshot each step and acts like a person. It only touches windows you add below, you can stop it any time with ⌥⇧⎋, and every session is logged. Off by default."_), the enable `Switch` (`discover.enabled`-style `Controller`), a target-allowlist editor (list of removable chips + an `Input` + Add button that appends to `form` value `computerUse.targetAllowlist`), and `maxSteps` / `settleMs` number `Controller`s. Follow `knowledge-base.tsx` / `discover.tsx` layout.
- `services/computer-use.ts`: `export const abortComputerUse = () => fetcher('/api/computer-use/abort', { method: 'POST' })`; `export const answerComputerUse = (sessionId, answer) => fetcher('/api/computer-use/answer', { method: 'POST', body: { sessionId, answer } })`.
- `settings-form.tsx:132`: `{activeTitle === SettingsLabel.ComputerUse && <ComputerUse form={form} />}`.

- [ ] **Step 1: add test-ids; write the failing e2e** — `settings-computer-use.spec.ts`: open Settings → Computer Use; `enableToggle` visible; type "Chess" into `allowlistInput`, click `addTargetButton`, "Chess" chip appears.
- [ ] **Step 2: run linkage test → fails (orphan ids).**
- [ ] **Step 3: implement the page + service + form dispatch.**
- [ ] **Step 4: `pnpm vitest run` (linkage passes) + `pnpm typecheck:web`.**
- [ ] **Step 5: Gate + commit** — `"feat(computer): Settings → Computer Use page"`

---

## Task 13: Chat panel + docs

**Files:**

- Modify: `src/renderer/components/messages-calling-tools.tsx` (+ a `ComputerUseCard` — inline or a new file `web-search`-sibling), `src/shared/constants/test-ids.ts` (if the Stop button needs one), `CLAUDE.md`
- Test: extend `settings-computer-use.spec.ts` or a new `tests/e2e/computer-use-panel.spec.ts` only if a test-id is added

**Interfaces:**

- `messages-calling-tools.tsx`: add `'computerUse'` to `BUILTIN_TOOL_NAMES`; render `{toolName === 'computerUse' && <ComputerUseCard toolResult={output} />}`.
- `ComputerUseCard`: reads `details` (the last `SessionUpdate` streamed, or the final `{sessionId, outcome, steps}`). Renders: a header (`Computer Use · {outcome ?? 'running'}`), the current/last step + action, an optional thumbnail (`details.thumbnail` base64), and — while `!outcome` — a **Stop** button calling `abortComputerUse()`. On `details.awaitingHuman`: an inline question + text input + "Done — continue" button calling `answerComputerUse(sessionId, value || '(done)')`. On completion: a "View episode" link to `#` (V0: just show `traceId` text; wiring the Logger deep-link is optional polish).
- `CLAUDE.md`: under "Built-in tools" add `computer-use`; add a `src/main/lib/computer/` bullet to Code Structure ("window-scoped screenshot-loop computer-use Runtime: `actovia-input` Swift helper, capture/target/hands/guard, the `runComputerSession` loop; see docs/superpowers/specs/2026-09-06-computer-use-v0-design.md"); add `/api/computer-use` to the route list.

- [ ] **Step 1: implement the card + `BUILTIN_TOOL_NAMES` entry.**
- [ ] **Step 2: `pnpm typecheck:web` + `pnpm vitest run`.**
- [ ] **Step 3: update CLAUDE.md; `pnpm test` (claude-md-freshness passes).**
- [ ] **Step 4: Gate + commit** — `"feat(computer): chat panel for computerUse sessions + docs"`

---

## Self-Review

**Spec coverage:**

| Spec §                                                   | Task                                                     |
| -------------------------------------------------------- | -------------------------------------------------------- |
| §1 shape, blocking tool                                  | 8, 9                                                     |
| §2.1 types                                               | 2                                                        |
| §2.2 target                                              | 6                                                        |
| §2.3 capture + scaling                                   | 5                                                        |
| §2.4 hands                                               | 4                                                        |
| §2.5 guard                                               | 3                                                        |
| §2.6 helper                                              | 1, 2                                                     |
| §3.1 ComputerAgent                                       | 7                                                        |
| §3.2 action tools                                        | 7                                                        |
| §3.3 screenshot trim                                     | 7                                                        |
| §3.4 system prompt                                       | 7                                                        |
| §3.5 loop controls, askHuman, stuck                      | 8                                                        |
| §3.6 trace                                               | 8                                                        |
| §4.1 ask registry                                        | 7                                                        |
| §4.2 safety (window scope, abort, allowlist, motor-only) | 3, 8, 9, 10                                              |
| §5.1 settings schema                                     | 11                                                       |
| §5.2 settings page                                       | 12                                                       |
| §5.3 chat surface                                        | 13                                                       |
| §6 Swift helper                                          | 1                                                        |
| §8 testing                                               | every task                                               |
| §9 non-goals                                             | respected (no DOM/AX, no video, no local model, no bash) |

No gaps.

**Placeholder scan:** the system-prompt full text lives in Task 7 Step 3 as a reference to spec §3.4 — the spec has the gist, Task 7 must write the final wording; flagged, not hidden. `tool-binding-util.ts`'s exact `enabled(...)` gate style is "check and follow the existing pattern" (Task 9) — the file wasn't read during planning; the implementer reads it. Everything else is concrete.

**Type consistency:** `Action`, `HelperCommand`, `TargetWindow`, `ComputerState`, `SessionResult`, `SessionOutcome`, `SessionUpdate` defined once (Task 2 / Task 8) and referenced by exact name downstream. `resolveTarget`/`refreshBounds`/`screenshotWindow`/`execute`/`decompose`/`trimImages`/`toolCallToAction`/`runComputerSession`/`computerAskRegistry` signatures match across defining and consuming tasks. Coordinate convention (window-relative in, `bounds[0] + x/scaleFactor` out) stated identically in §2.3/§2.4 and Tasks 4–5.

---

## Execution notes

- **Order matters:** Tasks 2–6 are independent given Task 2's types and can be done in any order; 7 needs 2; 8 needs 2–7; 9 needs 8; 10 needs 8–9; 11 is independent; 12 needs 11; 13 needs 9. Sequential is safe.
- **Hard to verify here:** the Swift helper's `screenshot`/`input` need macOS TCC grants (the user does this once), and the real perceive→act loop needs a live screen + a real Claude call + a real target app. Everything else is covered by the mock-helper + scripted-agent tests. Mark the real end-to-end run (play a few chess moves) as a **manual acceptance step** for the user after Task 13.
- **This is a large plan (13 tasks).** Task 1 (the Swift helper) is the only piece that could be pulled into its own plan; it's kept here because nothing downstream can be exercised without it.
