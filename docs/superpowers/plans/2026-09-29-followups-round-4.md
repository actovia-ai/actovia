# Follow-ups, round 4 (owner's list of 2026-09-29, evening)

Eleven points from the owner after testing on the phone and the desktop. Two
are answers (2, 5/6); nine are work. This plan is written to be executed by
another model: every item names its files, its cause where one was found, what
to build, and how to check it.

## Standing rules (apply to every item)

- **Two repos.** Desktop: `/Users/yanceyleo/Code/actovia/actovia` (branch
  `feat/react-query`). iOS: `/Users/yanceyleo/Code/actovia/ios` (branch
  `main`). Everything is uncommitted in both and stays that way: no commit, no
  stash, no reset, no `git subtree`, no `--no-verify`. The owner tests and
  commits.
- **The owner's dev app is running** on the real `~/.actovia` (ports 60223 /
  5173). Do not start, stop or restart it; no `bun run package`, no e2e; no
  non-GET request to `localhost:60223`; never read or write `~/.actovia`.
- **TDD.** Test first, watch it fail for the right reason, then the code.
- **Desktop gates** before calling a desktop item done: `bunx oxfmt <touched
  files>` (never repo-wide `bun run fmt` / `lint:fix`), then
  `env PWD=/Users/yanceyleo/Code/actovia/actovia bun run typecheck`,
  `bun run lint` (0 errors), `bun run i18n:check`, `bun run fmt:check`,
  `bun run test`. New strings go into all 10 locales in the same change.
  CLAUDE.md is updated in the same change when behaviour it describes changes.
- **iOS gates**: `tuist generate --no-open` after adding or removing a file;
  build for the iOS 27 simulator (iPhone 18 Pro,
  `2E24BDB8-4ED5-4EA9-92D0-7B377C6CC731`); the test schemes `ChatFeature`,
  `MarkdownKit`, `SettingsFeature`, `Models`; `python3 scripts/l10n.py audit`
  at `0 error(s)`. Screenshots in light and dark through the DEBUG galleries
  (`-MessageGallery`, `-MarkdownGallery`, `-CardPrototypes
  -CardPrototypesSection map`, `-ColorTone <name>`).
- **Screenshots go where the owner can find them** (point 5/6): copy every
  screenshot that a report mentions to `~/Desktop/actovia-shots/<item>/` and
  give absolute paths in the report. The session scratchpad is a temp
  directory the owner does not browse.
- **What cannot be verified is said so.** A long press, a drag, real audio, a
  real network icon and a real device cannot be exercised from here.

## Order

| Batch          | Items       | Size   | Notes                                              |
| -------------- | ----------- | ------ | -------------------------------------------------- |
| A — iOS, small | 9, 4, 7 + 3 | small  | independent of each other                          |
| B — desktop    | 11, 8       | medium | 8 also gets an iOS test                            |
| C — iOS, large | 1, then 10  | large  | each is a design + build task; review before build |

Batch C is where a weaker model is most likely to go wrong (UIKit text
selection inside SwiftUI; a full-screen MapKit layout). Do A and B first.

---

## 9. Copy button: the glyph changes size (iOS)

**Cause.** `TurnActionBarView.copyButton`
(`Sources/ChatFeature/TurnActionBarView.swift`) swaps the SF Symbols
`doc.on.doc` and `checkmark`, which have different widths; the label takes
the glyph's width, so the row shifts.

**Build.** Give every glyph of the bar one box: a
`@ScaledMetric(relativeTo: .subheadline)` side (20 pt) applied as
`.frame(width: side, height: side)` to the icon of Copy, Read aloud and
Regenerate (the spinner of Read aloud sits in the same box). Keep
`.contentTransition(.symbolEffect(.replace))`.

**Check.** Screenshot the bar before and after Copy (the Message gallery has a
launch flag for bar states; add `-MessageGalleryCopied` if there is none) and
compare the x position of the next glyph: equal. Desktop: `CopyIcon` and
`CheckIcon` are both sized by `[&_svg]:size-4` in `IconWrapper`; confirm no
shift and change nothing if so.

## 4. Under an answer: order and room (iOS)

Owner's screenshot: the gap above the action row is large; the last message
sits almost on the composer even when scrolled to the end; "Used 3 memories"
is under the action row.

**Build** (`AssistantTurnView.swift`, `RunFootView.swift`,
`MemoryFootViews.swift`, `ChatDetailView.swift`):

1. Order under the answer text: search media → error line → approvals →
   **"Used N memories"** → memory change strip → **action row** → "N other
   version(s)". The action row is the last thing of a turn that has one.
2. Gaps, measured ink to ink on a 3x screenshot: answer's last line → first
   foot row 8 pt; foot rows 6 pt apart; last foot row → action row glyphs
   8 pt; when there is no foot row, answer → action row 8 pt. 44 pt targets
   stay, overlapping the gaps (`TurnFootMetrics` / `footRowTarget()` already
   do this).
3. The end of the transcript clears the composer: the scroll content's bottom
   margin is the composer's height plus 16 pt, so the last row's ink ends
   16 pt above the composer's top edge when scrolled to the end. Find how the
   composer is placed over the transcript in `ChatDetailView` (a glass
   composer over the scroll view) and use `safeAreaInset(edge: .bottom)` for
   it, or `contentMargins(.bottom, _, for: .scrollContent)` fed by the
   composer's measured height. Scroll-to-end and the keyboard must still
   work.

**Check.** Tests for the order rule (a pure function returning the foot rows
of a turn in order). Screenshots of the last turn of the Message gallery
scrolled to the end (`-MessageGalleryEnd`), with and without a memory line,
light and dark; state the measured gaps.

## 7 + 3. Sources sheet: what a turn cites, and which rows are cited (iOS)

**Cause of 7.** `SourcesSheetModel.init(turn:marker:)`
(`Sources/ChatFeature/SourcesSheetModel.swift`) lists `turn.sources` — the
turn's own search results — and, when the tapped chip's source is not among
them, inserts that one source. A turn that ran no search of its own but cites
an earlier turn's results therefore shows one row.

**Desktop reference for 3.** `src/renderer/components/sources-panel.tsx`:
`parseCitations(messageText)` gives the cited ranks; the panel shows
"Citations (n)" and then "More".

**Build.**

1. `SourcesSheetModel` gets two sections:
   - `cited`: every source the turn's text cites, resolved as the chips
     resolve them (`turn.citation(forMarker:)`, i.e. the cumulative
     `turn.citations`, last source of a rank wins), one row per link, in
     order of first citation;
   - `more`: the turn's own `sources` that are not cited, in the order found.
     The tapped chip's row is highlighted and scrolled to. Entry ids stay
     unique across both sections.
2. Section headers with the desktop's strings from the vendored catalog:
   `chat:sourcesPanel.citations` (plural, with its count) and
   `chat:sourcesPanel.more`. No header when only one section has rows.
3. The Sources button of the action row (`TurnActions.bar`) shows when the
   turn has own sources **or** cites any; its avatars and its VoiceOver count
   come from cited-then-more.

**Check.** Tests: a second turn with no search of its own citing ranks 1 and 3
of the first turn → two cited rows, the tapped one highlighted; a turn with
ten results citing two → 2 cited + 8 more; the same link under two ranks →
one row; a marker that resolves to nothing → no row. A Message gallery run for
the two-turn case; screenshots of the sheet, light and dark.

## 11. Several sources in one chip: one card with a pager (desktop)

Owner: the stacked list grows without bound; go back to the single-source
card and add an indicator, like the reference (← → and "1/2" above the card).

**Build** (`src/renderer/components/markdown-citations.tsx`):

- The hover card shows **one** source, drawn as the single-source card is
  today (thumbnail, site line, title, snippet) — `SourceCard` with
  `rich` always true.
- With more than one source, a header row above it: previous / next (shadcn
  `Button`, `variant="ghost"`, `size="icon-sm"`, lucide `ArrowLeftIcon` /
  `ArrowRightIcon`, disabled at the ends, `aria-label`s from the catalog) and
  "n/total" at the right in `text-muted-foreground`, tabular numbers.
- The index is state of the chip and resets to the first source when the card
  closes. Width stays `w-72`. No animation when paging (it is a repeated
  action); the card's own enter/exit stays as it is.
- The chip itself still opens its first source; the card opens the source it
  shows.
- Strings in all 10 locales: `chat:citation.previous`, `chat:citation.next`,
  `chat:citation.position` ("{{current}}/{{total}}").

**Check.** Render test (happy-dom, open card mocked as always open the way
`nav-histories.test.ts` mocks the menu): three sources → "1/3" and the first
title; next → "2/3" and the second; previous disabled on the first, next
disabled on the last; one source → no header. Visual check through the Vite
page with mocked routes (see `reference-renderer-visual-check-playwright` in
memory), light and dark; remove `.playwright-mcp/` afterwards by asking the
owner if the tool refuses.

## 8. A `【N-source】` that stays text (desktop, then iOS)

**What was found.** A fetched page is already registered as a source
(`messages.tsx`, the `TOOL_NAMES.webFetch` branch of `buildAssistantTurn`).
What is not covered is **where the marker stands**: `markdown.tsx` replaces
markers only in the direct text of `p`, `li`, `td` and `th`
(`TextWithCitations`). A marker inside `**bold**`, `*emphasis*`, `~~del~~`, a
heading or a link's text is left as typed — and a summary of a fetched page
is where models write headings and bold with citations.

**Build.**

1. Reproduce first: render tests with the marker in each of bold, emphasis,
   strikethrough, `h2`, link text, a table cell, a blockquote paragraph; and
   in inline code and a code block, where it must stay literal.
2. A remark transform `remarkCitations` (new file in `src/renderer/lib/`,
   added to `remarkPluginsStable` in `lib/markdown-plugins.ts` — transforms
   do not move the block splitter's boundaries): every `text` node is split
   on markers into text and `citation` nodes
   (`data: { hName: 'cite-chip', hProperties: { ranks: '1,2' } }`). Code is
   not a `text` node, so it is untouched.
3. The grouping rules of `lib/citation-chips.ts` (`splitCitations`: one chip
   per place, markers side by side merge, closing punctuation stays with the
   chip) move to work on sibling nodes; keep its tests green by keeping the
   string function as the core and calling it from the transform.
4. `components['cite-chip']` in `markdown.tsx` draws `CitationChip` from the
   rank map context (`WebSearchRankMapContext`); ranks that resolve to
   nothing draw nothing. Remove the `TextWithCitations` wrappers from `p`,
   `li`, `td`, `th` once the transform covers them.
5. A second thing to pin with a test, not assumed broken: the rank registry
   is a `Map` created per request (`bindCallingTools`), so a later run's
   ranks start at 1 again; each turn resolves against the sources up to and
   including itself, last wins. Test that turn 1's chips still resolve to
   turn 1's sources after turn 2 fetched a page that took rank 1.
6. iOS: add the same cases to `MarkdownKitTests` (marker inside strong,
   emphasis, heading, link). Fix the styler only if a case fails.

**Check.** The render tests; `markdown-blocks.test.ts` and
`messages-rerender.test.ts` still green (the chips must not make a settled
block re-render per frame — the rank map stays in context, never in
`components`).

## 1. Selecting words in a message (iOS)

Owner: "正常的长按划词选中复制" — a long press selects a word, handles extend
the range, the system menu copies. Not a menu that copies the whole message.

**What is true today.** SwiftUI's `Text` with `.textSelection(.enabled)` on
iOS offers Copy of the whole text at best, never a range, and the answer's
text is drawn with a custom `TextRenderer` (the chips). The long-press
context menu added on 2026-09-29 (`MessageCopy.swift`) takes the long press.

**Build.**

1. Remove the long-press context menu from answers and from the user bubble.
   The action row's Copy stays (whole answer, with references). Keep
   `CopiedAnswer`; delete the Select Text sheet and its strings if nothing
   else opens it.
2. `SelectableText`: a `UIViewRepresentable` over `UITextView` — not
   editable, selectable, not scrollable, `textContainerInset = .zero`,
   `lineFragmentPadding = 0`, clear background,
   `adjustsFontForContentSizeCategory`, sized by
   `sizeThatFits(_:uiView:context:)`. Links and chips are taps through the
   delegate (`textView(_:primaryActionFor:defaultAction:)`), routed to the
   same handlers as today (`openURL`, the citation tap).
3. A pure builder from `MarkdownInlineStyler.Output` to
   `NSAttributedString`: text segments with their fonts and colours
   (`UIFont` equivalents of `MarkdownFontSpec`), the paragraph's line
   spacing, and each chip as an `NSTextAttachment` whose image is the chip
   as drawn today (capsule, icon, label — render it once per chip and again
   when its icon arrives or the appearance changes), with a link attribute
   for the tap and bounds that put its middle where
   `MarkdownChipMetrics` puts it.
4. Copy of a selection: a `UITextView` subclass overrides `copy(_:)` and
   writes the selected text with attachments left out, so a pasted range has
   no object-replacement characters.
5. Use it for every inline text of an answer (paragraph, heading, list item,
   quote, table cell) and for the user bubble. The block that is still
   streaming keeps the SwiftUI renderer and becomes selectable when it
   settles, so a frame does not rebuild a `UITextView`.
6. **Limit to state to the owner:** a selection lives inside one block (one
   paragraph, one list item). A range across paragraphs needs the whole
   answer in one text view, which is a rewrite of the markdown layout; not in
   this round.

**Check.** Tests for the builder (fonts, colours, one attachment per chip,
link attributes, the copied string of a range that includes a chip).
Galleries in light and dark, default and a large Dynamic Type size, Latin and
Chinese: the text must sit exactly where the SwiftUI renderer put it (compare
screenshots before and after; line breaks equal). The long press, the handles
and the edit menu cannot be exercised on the simulator from here — say so,
and ask the owner to try: user bubble, a paragraph with a chip, a list item,
a heading, while the drawer's edge swipe still works.

## 10. The itinerary's full-screen map (iOS)

Owner: make it immersive and full screen, use what MapKit for SwiftUI gives
(https://developer.apple.com/documentation/mapkit/mapkit-for-swiftui), native
components where possible; the location button spins for ever; the route
colours are "standard" colours like the old tones.

**What is there** (`MapItineraryFullView` in
`Sources/ChatFeature/MapItineraryCard.swift`): a `NavigationStack` with the
day picker, a map at 46 % of the height and a `List` under it; the place
detail is a sheet. `.mapControls` already has `MapUserLocationButton`,
`MapCompass`, `MapScaleView`, `MapPitchToggle`, and the map has
`UserAnnotation()`.

**Build.**

1. **Layout.** The map fills the screen (`ignoresSafeArea`). Over it: a close
   button and the trip's title at the top (glass, `glassEffect`), the day
   picker under them (the shared `MapDayPicker`, on glass). The stops are a
   native sheet that is always there: detents a peek height (day header and
   one or two rows), `.medium`, `.large`;
   `presentationBackgroundInteraction(.enabled(upThrough: .medium))`;
   `interactiveDismissDisabled()`; the sheet holds its own `NavigationStack`,
   and a stop pushes its place detail inside the sheet instead of opening a
   second sheet. The map takes the sheet's height as bottom safe-area padding
   so the camera frames the route in the part that is visible.
2. **MapKit.** `Map(position:selection:)` with `Marker` per stop (tint = the
   day's colour, `monogram` = the stop's number) in place of hand-drawn
   badges where MapKit's marker can carry them; `MapPolyline` per day;
   `.mapStyle(.standard(elevation: .realistic))`; `.mapControls` as now;
   `LookAroundPreview` in the place detail when
   `MKLookAroundSceneRequest` finds a scene; "Open in Maps" through
   `MKMapItem.openInMaps`. Routes stay straight legs in this round;
   `MKDirections` per leg is a later step (it is rate-limited and needs a
   travel mode per leg).
3. **Location button.** It spins because nothing ever asks for permission.
   Add `NSLocationWhenInUseUsageDescription` to the app's Info.plist
   (`Project.swift`, localized in `InfoPlist.xcstrings` for every shipped
   language), request when-in-use authorization the first time the full map
   appears (a small `@Observable` wrapper over `CLLocationManager`), show the
   button and `UserAnnotation()` only while authorization is granted or not
   yet asked, and not at all when denied or restricted. Check first what the
   owner added by hand (`git diff` of the file) and keep it.
4. **Colours.** Replace the system hues of `MapDayPalette` with a designed
   set in the family of the tone palette: the six reference accents
   (#5480F0, #6CB362, #EDC859, #E17EAD, #DE8344, #8553E7) plus two that fill
   the gaps of the hue circle (a teal and a slate), each with a variant for
   dark map tiles derived in OKLCH (`OKLCH.swift`). Day one is the chat's
   tone; following days take the palette in an order that keeps neighbours
   far apart in hue and skips the tone's own hue. A route is drawn with a
   casing, and each colour holds 3:1 against the light and the dark map
   tiles; past eight days the pattern repeats dashed, as now.
5. The inline card keeps its layout and takes the new colours.

**Check.** Tests: palette (eight distinct hues, neighbours apart, contrast on
both tile colours, day one = tone), the authorization wrapper's states, the
camera region for a day with the sheet at each detent. Screenshots of the
Kyoto, Vienna and seven-day fixtures in the full view (`-CardPrototypesMapFull
day`), sheet at peek and medium, light and dark, two tones. The location
prompt and the blue dot need a device or a simulated location: say what was
seen.

---

## Answers, no work

- **2.** `.playwright-mcp/` was removed by the owner.
- **5 / 6.** The screenshots of the earlier rounds are in the session's temp
  directory, which is why they were not found:
  `/private/tmp/claude-501/-Users-yanceyleo-Code-actovia-actovia/bf42e566-e7d0-4c56-b1f7-709455611cde/scratchpad/ios-shots/`
  (names starting with `n-` are the neutral-tone ones; desktop ones are in
  `…/scratchpad/shots/`). From this round on they are copied to
  `~/Desktop/actovia-shots/`.

## Status — 2026-09-29, night

- **11 done** (desktop): one source per card with a pager; the card is keyed
  by the source, so the icon follows the page.
- **8 done** (desktop): `remarkCitations` + `citationComponents`;
  `TextWithCitations` is gone. Also done, found on the way: sources are
  numbered through a chat (`highestSourceRank`, `rankBase`) — every run
  used to start at 1 again.
- **9, 4, 7 + 3 done** (iOS), screenshots in `~/Desktop/actovia-shots/round-4/`.
- **1 done** (iOS): answers and the user bubble are `UITextView`s
  (`MarkdownKit/SelectableText.swift`, `MarkdownAttributedText.swift`); the
  block still streaming keeps the SwiftUI renderer. The long press itself
  was not exercised on the simulator.
- **12 added and done on both platforms** (owner, same night: "对选中的文本进行
  提问"): desktop `chat/selection-ask.tsx` + `chatQuoteAtom`; iOS "Ask Actovia"
  first in the selection's edit menu (`markdownAskAbout`), `ComposerQuote`;
  one shared text format, `quoted-text.ts` / `QuotedText.swift`.
- **10** in progress in a separate run.
