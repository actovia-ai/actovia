# Philharmonic P1-7 — Artifact-rendered final report

**Date:** 2026-06-05
**Status:** Approved, executing
**Scope:** PM gains a `createReport(title, code)` tool that produces a React component rendered live in the chat via the existing Artifact pipeline. The deliverable a Group hands back to the user can now be a polished interactive artifact instead of plain text.

## Goal

Today the PM's final message is a plain markdown string in `conversation_message.content`. For complex deliverables — a dashboard, a comparison table, a charted summary — that's a regression from what Chat already supports. P1-7 wires the existing `saveArtifact` / `ArtifactCard` plumbing into Philharmonic with the smallest possible surface area: one new tool, one new persisted part kind, one reused render component.

## Decisions

- **Reuse, don't fork.** The on-disk artifact format (`{artifactId}.tsx` + `{artifactId}.json` next to it) and the renderer's `ArtifactCard` are unchanged. We pass `conversationId` everywhere `chatId` used to flow — UUIDs don't collide and the existing reveal IPC resolves to the right path.
- **Save to `~/.actovia/artifacts/{conversationId}/`.** Reusing `getArtifactsDir()` means the existing reveal-artifact-file IPC works unchanged. No second IPC handler.
- **No new SSE event.** `createReport` is itself a tool — its execution already produces `tool_card phase=start/end` events. The end event carries `details: {type: 'artifact', artifactId, title, code}` just like Chat's `createArtifact`. The renderer's existing tool-card aggregation handles the live case.
- **Code lives in the message row.** The artifact is attached as a part on the PM's final `conversation_message` (`{kind: 'artifact', artifactId, title, code}`). Storing code in the row mirrors Chat's behavior and keeps replay/history rendering trivial — no extra fetch round-trip.
- **One report per turn is the v1 contract.** The PM may call `createReport` multiple times in a turn; every result is attached. Future P2 can introduce a "report registry" if curation matters.

## Out of scope

- Multi-author artifacts (employees creating artifacts the PM merges).
- Artifact editing UI inside Philharmonic.
- A "Reports" tab listing all artifacts a Group has produced.

## Pieces

### `createReport` tool (new)

Lives at `src/main/lib/ai/philharmonic/report-tools.ts`. Constructor takes `conversationId` and an `onCreate` callback so the PM coordinator can stash the result for persistence.

```ts
export function createReportTool(
  conversationId: string,
  onCreate: (artifact: {
    artifactId: string
    title: string
    code: string
  }) => void
): AgentTool
```

Schema mirrors Chat's `createArtifact` but with a description focused on "polished final deliverable for the user" rather than "interactive chart from intermediate data". Execute: generates a uuid, calls `saveArtifact(conversationId, artifactId, title, code)` (fire-and-forget — same as Chat), pushes to `onCreate`, returns `{ content: text, details: { type: 'artifact', artifactId, conversationId, title, code } }`.

### PM coordinator wiring

`runPmCoordinator`:

- Allocates a `pendingArtifacts: Array<{artifactId, title, code}>` at the top of the run.
- Adds `createReportTool(conversationId, (a) => pendingArtifacts.push(a))` to the tools list.
- After the loop ends successfully and the PM's final text is computed, persists the message with `parts` set to the artifact parts (if any).

### Stored part shape

```ts
{
  kind: 'attachment'
  name
  url
  contentType
} // existing
{
  kind: 'artifact'
  artifactId
  title
  code
} // new
```

The discriminator scheme already handles heterogeneous parts; the bubble renderer just adds a branch.

### Renderer

- `BubbleModel` (group-message-bubble.tsx) gains `artifacts?: Array<{artifactId; title; code}>`.
- `GroupChat` merges artifact parts from history rows into the bubble model (same place attachments get pulled out today).
- `GroupChat` also merges artifact tool-card results from the live `bubbles` stream — each artifact tool_card details `{type:'artifact', artifactId, title, code}` becomes a bubble artifact.
- `GroupMessageBubble` renders an `ArtifactCard` per entry. Existing `ArtifactCard` is imported and passed `chatId={conversationId}` and the synthetic `toolResult: ArtifactDetails` shape it already expects.

### Tool description

The createReport description tells the PM:

- Call this **only at the end** of a turn when the deliverable benefits from rendering (charts, dashboards, comparison tables, structured summaries).
- One call per logical artifact — multiple `createReport` calls produce multiple artifacts.
- Code follows the same theme-token / TSX-component rules Chat's createArtifact already documents (reused verbatim, since the sandbox is the same one).

## File touchpoints

| File                                                                 | Change                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------- |
| `src/main/lib/ai/philharmonic/report-tools.ts` _(new)_               | createReportTool                                         |
| `src/main/lib/ai/philharmonic/pm-coordinator.ts`                     | bind tool; collect artifacts; persist parts              |
| `src/renderer/components/philharmonic/chat/group-message-bubble.tsx` | render ArtifactCard for artifact parts                   |
| `src/renderer/components/philharmonic/chat/group-chat.tsx`           | thread artifact parts (history + live) into bubble model |

## Tests

- `report-tools.test.ts` — execute pushes artifact to onCreate and returns the right detail shape.

## Rollout

Single commit. No migration.
