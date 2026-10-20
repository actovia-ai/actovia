# Computer Use — A Survey Toward Actovia's "Computer Runtime"

**Date:** 2026-09-06 · **Status:** research / literature survey. No
implementation commitment.

**Inputs:** the user's blog _"AI's Ultimate Form"_
(`yanceyleo.com/post/1b27acf6…`); the full user↔ChatGPT thread
(pasted 2026-09-06); and the published state of the field as of early
September 2026.

**Thesis under examination.** The blog argues that the endgame for AI
operating a computer is _not_ `screenshot → VLM → mouse-API`, but a
closed-loop control system on the model of Tesla FSD: the screen is a
sensor, the model maintains a continuously-updated world state, a
high-level agent sets goals, and a low-level controller drives
mouse/keyboard from continuous visual feedback. This document checks that
thesis against the literature and derives what Actovia can actually build.

**Bottom line up front.** The blog was ~12–18 months early and the field
has now converged on most of it — _video-native perception_,
_observation control_, _GUI world models_, _brain/controller hierarchy_,
and _the latency problem_ are all named, active research directions in 2026. **Nobody has shipped the full loop.** The hard parts (a reliable
GUI world model; real-time streaming control) are exactly where research
is currently stuck. Actovia cannot close those gaps — but it is unusually
well-placed to be the _harness_: a shipping, multi-model, fully-traced
operator environment. That is a systems-and-measurement contribution, and
it is enough for a paper.

---

## 1. The vision (blog + thread)

Five claims:

1. **Perceive video, not screenshots** — discrete frames lose the
   _trajectory_; a single screenshot is a _state_, not a _process_.
2. **The screenshot→infer→parse→act loop is too slow** — ~minute-scale
   per decision vs. human millisecond reflexes.
3. **Tesla FSD is the existence proof** — cameras stream, the model runs
   real-time and _collocated_, and it is "not frame-by-frame independent"
   (it carries temporal / world state).
4. **Deploy inference at neighbourhood scale** — AI "substations", not
   pure cloud or pure local.
5. **Emit human motor primitives, not app APIs** — so the policy can
   later transfer to a physical robot.

The thread converges these into an architecture — a **`Computer Runtime`**
module Actovia owns, with the Agent layer swappable:

```
Actovia
 ├── Agent            (GPT-6 Astra / Claude 5 / Gemini CU / local — swappable)
 ├── Tools            (GraphRAG, Browser, Code, Computer)
 └── Computer Runtime
      ├── Capture          frames, cursor, target window/VM
      ├── Perception       DOM  +  Accessibility tree  +  Screenshot ("three-eye")
      ├── Temporal Engine  frame diff → change list → keyframes ("visual git")
      ├── World State      compact JSON, not images
      └── Controller       deterministic inner loop: observe→move→correct→click
```

---

## 2. State of the field — September 2026

### 2.1 Models and products

| System                                                                          | Notes                                                                                                                                                                                                                                                                                                                                                     | OSWorld (short) | OSWorld 2.0 (binary)                             |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------ |
| **GPT-6 Astra** (OpenAI, 3 Sep 2026)                                            | "computer operator" model; "Linear Attention V2", 1.05M ctx; async Responses API; `reasoning.effort` low→max. Internal arch undisclosed. ([OpenAI](https://openai.com/index/gpt-6-astra/), [Fortune](https://fortune.com/2026/09/03/openai-debuts-gpt-6-astra-computer-use-greg-brockman-says-start-of-agi/))                                             | SOTA-class      | leads leaderboard; ~27% binary / ~63% partial    |
| **Claude Opus 5** (24 Jul 2026) / **Sonnet 5** (30 Jun 2026)                    | Sonnet 5 is "the most agentic Sonnet" — plans, drives browsers/terminals autonomously. Sonnet 5 ≈ 81.2 OSWorld-Verified. ([Anthropic](https://www.anthropic.com/news/claude-sonnet-4-6), [morphllm](https://www.morphllm.com/claude-benchmarks))                                                                                                          | ~81–83          | Opus 5 ≈ 31% binary / 68% partial (leads binary) |
| **Gemini 2.5 Computer Use** (Oct 2025)                                          | browser + Android focus; "lower latency" per Browserbase. **Project Mariner retired as a standalone product 4 May 2026**, folded into the Gemini API / Agent / AI Mode. ([blog.google](https://blog.google/innovation-and-ai/models-and-research/google-deepmind/gemini-computer-use-model/), [Wikipedia](https://en.wikipedia.org/wiki/Project_Mariner)) | —               | —                                                |
| **UI-TARS-2** (ByteDance, [arXiv 2509.02544](https://arxiv.org/abs/2509.02544)) | fully open; pixels→coords, _no_ a11y tree; multi-turn RL + a **data flywheel** (model and corpus co-evolve); hybrid GUI env (FS + terminal).                                                                                                                                                                                                              | **47.5**        | —                                                |
| **Qwen2.5-VL** (7–72B)                                                          | best _open_ GUI-grounding family on ScreenSpot/OSWorld as of Apr 2026; the realistic self-host choice.                                                                                                                                                                                                                                                    | —               | —                                                |

**Read:** the open/self-host gap on full computer use is ~34 OSWorld
points (UI-TARS-2 47.5 vs Claude 81). Open models are close on _grounding_
(where to click) and _mobile_, far on _long-horizon desktop reasoning_.

### 2.2 Benchmarks — the shape of the gap

- **OSWorld** (original, 369 tasks): 12% (Apr 2024) → ~85% frontier
  (mid-2026). Short computer-use tasks are near-solved.
- **OSWorld 2.0** ([arXiv 2606.29537](https://arxiv.org/abs/2606.29537)):
  108 tasks, **median human time 1.6 h**, binary completion. Explicit
  challenge categories: _dynamic environments, streaming interaction,
  proactive interaction, cross-source reasoning, implicit-state
  inference_. Best system ≈ **31% binary completion**. This is the honest
  "did it finish the whole job" number.
- **AndroidWorld**: ~95% pass@1 (AskUI) — mobile narrow tasks solved.
- **WindowsAgentArena**: UI-TARS-2 50.6.
- **OSWorld-Human** ([arXiv 2506.16042](https://arxiv.org/abs/2506.16042)),
  **OS-Marathon** (long-horizon repetitive), **MMBench-GUI**,
  **MCPWorld**, **GUI-360°**, **LivingScreen** (see §2.6): the benchmark
  frontier has moved decisively to _long-horizon_, _efficiency_, and
  _dynamic/streaming_ — i.e. onto the blog's turf.
- **Efficiency**: best agents take **2.7–4.3× more steps** than necessary;
  end-to-end latency "tens of minutes" for tasks humans do in minutes —
  "practically unusable" for time-sensitive work.

### 2.3 Perception: what the model looks at

Four modalities, and the field has largely settled the trade-offs:

| Modality                                                              | Pros                                                            | Cons                                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Screenshot**                                                        | universal, no API, captures layout/style                        | HiRes → huge visual-token cost; quadratic history blowup                      |
| **Accessibility tree**                                                | text, compact, exact coords                                     | "inconsistency, volatility, limited scalability"; missing on many native apps |
| **Set-of-Marks** (numbered boxes on the screenshot, coords from a11y) | aligns text and pixels; low labeling overhead; efficient hybrid | needs a11y for the coords                                                     |
| **DOM** (web only)                                                    | structured, cheap, exact                                        | web only                                                                      |

Deployment-realistic benchmarks increasingly give agents **screenshot +
task only** — no a11y, no SoM — to mirror the real world.

**Grounding models** (predict where to click): UGround (10M elements /
1.3M screenshots, pixel coords), OS-Atlas, AGUVIS (4.2M samples),
OmniParser (MLLM parses screenshot → structured elements). 2026 pushes
toward **coordinate-free** grounding — **GUI-Actor** uses attention over
visual patches instead of emitting `(x,y)` — and toward efficiency:
**InnerZoom** ("one forward beats two"), test-time RL via region
consistency, **WinDOM** (self-family distillation for _small_-model
grounding).

### 2.4 Action space: the imperative → declarative shift

The blog wants _more, lower-level_ actions (raw motor primitives). The
field is moving the _opposite_ way for the Agent↔environment interface:

- **DMI** (Declarative Model Interface, [arXiv 2510.04607](https://arxiv.org/html/2510.04607v2)):
  collapse a GUI into 3 primitives — _access, state, observation_. "GUIs
  force LLMs to decompose high-level goals into lengthy, error-prone
  sequences of fine-grained actions → low success, excessive LLM calls."
- **Hybrid / MCP action spaces** — MCPWorld
  ([arXiv 2506.07672](https://arxiv.org/abs/2506.07672)), EE-MCP,
  "Screenshots or Tools?" ([arXiv 2608.03327](https://arxiv.org/html/2608.03327)):
  API when one exists → a11y for standard widgets → vision only as
  fallback. Measured: **agents that can call APIs take 33% fewer total
  actions.**
- **CoAct-1** ([arXiv 2508.03923](https://arxiv.org/abs/2508.03923)):
  write and run _code_ instead of clicking, when possible.
- **UltraCUA** ([arXiv 2510.17790](https://arxiv.org/abs/2510.17790)):
  a foundation model with a _native_ hybrid action space.

**Reconciliation:** these are not in conflict — they live at different
layers. The _Agent→Controller_ interface should be declarative ("go to
Settings", "find the refund button"). The _Controller's own_ vocabulary
is the motor primitives (`move`, `click`, `type`, `scroll`, `drag`).
Exactly the brain/controller split the thread proposes.

### 2.5 Temporal state, memory, and GUI world models

The blog's sharpest point — _a screenshot is a state, not a trajectory_ —
is now a research consensus:

- **Memory graphs with transition edges.** "A button press triggering a
  state change is captured as an _edge_ in a memory graph; new tasks
  query the graph." This _is_ the thread's "visual git" idea — already
  published. See Mem-W ([arXiv 2605.09317](https://arxiv.org/html/2605.09317v1)),
  MementoGUI ([2605.18652](https://arxiv.org/pdf/2605.18652)), "Executable
  Agentic Memory for GUI Agent" ([2605.12294](https://arxiv.org/html/2605.12294)),
  "Naive Visual Memory is Not Enough" ([2606.14106](https://arxiv.org/pdf/2606.14106)).
- **GUI world models** — simulate an action's effect _before_ taking it:
  MobileDreamer (image → task sketch → structured state prediction),
  **ViMo** (predicts the next observation as an _image_), **gWorld**
  (predicts the next state as _renderable web code_). Survey: "Agentic
  World Modeling" ([arXiv 2604.22748](https://arxiv.org/pdf/2604.22748)).
- **Architecture shift**: finite context window → structured state →
  **state-space models** (Mamba-style backbones) for the memory stream.
  This is precisely the "temporal representation / SSM" line the thread
  gestured at.
- **History compression** (the "don't reprocess 5 identical frames"
  problem): **VERA** (visual-evidence-retaining, training-free, cuts
  cumulative non-cache tokens **31.5–63.1%**), **AgentOCR** (render
  history as an image and compress _optically_), **HiconAgent** (anchor-
  guided history compression), consistency-guided token-dropping at
  chosen LLM layers. Typical practical envelope: ≤15 images + 64K context
  covers a full 1080p trajectory.

### 2.6 Streaming and video-native GUI agents

This is the blog restated by 2026 papers, sometimes almost verbatim:

- **"Continuous video, not sparse screenshots, is the critical missing
  ingredient for scaling these agents — sparse data lacks the temporal
  continuity required to build visual world models or learn the
  continuous spatial control policies necessary for human-like cursor
  movement."** — from the **VideoCUA** dataset paper (~10k
  human-demonstrated tasks, 87 apps, **30 fps** screen recordings +
  kinematic cursor traces + reasoning annotations; 55 h / 6M frames).
  Also **CUA-Suite** ([arXiv 2603.24440](https://arxiv.org/html/2603.24440)).
- **LivingScreen** ([arXiv 2606.04701](https://arxiv.org/abs/2606.04701)):
  first benchmark for _living-screen-native_ GUI agents — "operates on a
  screen evolving in continuous time and **actively decides which visual
  slice to observe** — information acquisition is an endogenous,
  cost-bearing decision, not a fixed data feed." Frontier models fail
  here; dominant failure = **over- and under-observation**. The paper
  names **"observation control" as a missing capability axis.**
- **StreamingVLM** ([arXiv 2510.09608](https://arxiv.org/abs/2510.09608),
  ICLR 2026, MIT HAN Lab): real-time understanding of _infinite_ video
  streams via a compact KV cache (attention sinks + short vision window +
  long text window). **~8 FPS on a single H100.** This is the closest
  thing to "video → model in real time" that actually runs.
- **Event-VStream** ([arXiv 2601.15655](https://arxiv.org/pdf/2601.15655)):
  _event-driven_ processing — compute only when something changes. The
  thread's "cheap local change detector → keyframes" idea.
- Action-side: **action chunking** lets VLA policies run real-time, but
  "naive chunked execution exhibits discontinuities at chunk boundaries"
  — "Learning Native Continuation for Action Chunking Flow Policies"
  ([arXiv 2602.12978](https://huggingface.co/papers/2602.12978)).

### 2.7 Hierarchy: brain and controller, explicitly

- **CODA** ([arXiv 2508.20096](https://arxiv.org/abs/2508.20096)):
  "Coordinating the **Cerebrum** and **Cerebellum** for a Dual-Brain
  Computer Use Agent with Decoupled Reinforcement Learning." Cerebrum =
  planning, Cerebellum = execution, trained separately. This is the
  thread's architecture, already built and RL-trained.
- **Agent S2 / S3** ([arXiv 2504.00906](https://arxiv.org/abs/2504.00906)):
  Manager + Worker with **proactive hierarchical planning** — replan
  after _every subgoal_, not just on failure. SOTA on OSWorld 15- and
  50-step at release.
- "Beyond Global Replanning: Hierarchical Recovery" and PEAR (a
  planner-executor robustness benchmark) round out the pattern.

### 2.8 Latency and efficiency

- **Speculative Macro Commit** ([arXiv 2609.03236](https://arxiv.org/abs/2609.03236)):
  −18.6% latency (sequential) / **−44.9% (real-world)** by committing
  predicted action macros and verifying in parallel.
- **SpecBox** ([arXiv 2607.23933](https://arxiv.org/html/2607.23933)):
  start sandbox/environment preparation _before_ LLM inference finishes —
  today it's serialized on the critical path.
- **Agent JIT Compilation** ([arXiv 2605.21470](https://arxiv.org/html/2605.21470)),
  "Act While Thinking" (pattern-aware speculative tool exec), Dynamic
  Speculative Agent Planning.
- **Caching**: Browser-Use converts successful action traces into
  reusable code tools — the second run of a task skips the model almost
  entirely.
- Systems: speculative decoding, paged KV cache, MoE routing, streaming
  pipelines.

### 2.9 Training: environments are the bottleneck, not model size

- **CUA-Gym** ([arXiv 2605.25624](https://arxiv.org/abs/2605.25624)):
  co-generates _task + environment state + reward function_; ships
  CUA-GYM-HUB (94 mock web apps grounded in O\*NET + the Anthropic
  Economic Index). Scales with data volume without saturating.
- **OpenComputer** ("verifiable software worlds"), **DreamGym**
  (synthetic RL experiences, [arXiv 2511.03773](https://arxiv.org/pdf/2511.03773)),
  ComputerRL, Workflow-GYM, InfiniteWeb, AutoWebWorld, GUI-Genesis,
  PhoneBuddy, NeMo Gym.
- The lesson (also the UI-TARS data-flywheel lesson): **verifiable
  environments + synthetic data** is how the open models are closing the
  gap. A shipping harness that _records real user sessions_ is a data
  asset.

### 2.10 Security — the reason V0 runs in a box

- **OWASP Top 10 for Agentic Applications 2026** (Dec 2025): **#1 =
  Agent Goal Hijacking.**
- **"Claudy Day"** (Mar 2026): invisible prompt injection chained to data
  exfiltration stole `claude.ai` conversation history.
- **Visual / environmental prompt injection**: malicious instructions
  hidden in page HTML, metadata, alt-text, document bodies — the agent
  _reads its environment_ and is steered by it.
- Defenses: sandboxed execution (**ceLLMate**, [arXiv 2512.12594](https://arxiv.org/pdf/2512.12594)),
  untrusted-content masking with guarantees
  ([arXiv 2607.05277](https://arxiv.org/pdf/2607.05277)), the _guardian_
  pattern, human confirmation for high-impact actions,
  architecture-lifecycle frameworks
  ([arXiv 2605.07110](https://arxiv.org/pdf/2605.07110)). Survey: "JARVIS
  or Ultron?" ([arXiv 2505.10924](https://arxiv.org/pdf/2505.10924)).
- **Anthropic's own reference implementation runs Claude in an isolated
  Docker/X11 VM — explicitly "not your real machine."**

### 2.11 Self-hosting economics (the homelab path)

- **Qwen2.5-VL-7B**, **AWQ INT4**: halves the weights, keeps ~95%+ of
  grounding-benchmark quality (small hit on web clicks, larger on dense
  document reading).
- A single **RTX 5090** (or the homelab's GPU box) runs this comfortably;
  NVFP4 gives ~1.6× throughput over BF16 at 2–4% quality loss.
- Self-hosted inference ≈ **$0.001–0.04 / M tokens** (electricity),
  40–200× cheaper than budget cloud; hardware ROI < 4 months at ~30M
  tokens/day.
- Product per-task cost has already fallen **$0.50–1.50 (2024) →
  $0.05–0.15 (2026)** on the cloud side.

**So "collocated inference" for Actovia is real and affordable:** an
INT4 grounding VLM on the homelab, reached over Tailscale (single-digit-ms
RTT). Not a neighbourhood substation — a box in a closet — but the same
architectural idea.

---

## 3. The FSD analogy, examined properly

The blog leans hard on Tesla FSD. The right reference architecture in the
literature is **UniAD** (CVPR 2023 best paper) and its world-model
successors:

- **UniAD**: multi-view camera → **BEV feature space** → TrackFormer
  (agents) + MapFormer (online map) + MotionFormer (trajectory
  prediction) + **OccFormer** (occupancy) + Planner. All modules are
  transformer decoders; **"task queries as interfaces" connect them**;
  the whole stack is **differentiable end-to-end** so planning loss
  back-props into perception. Explicitly modelled on Tesla's occupancy
  network.
- World-model successors: **GAIA-1** (generative driving world model),
  **DrivingGPT** (unifies world modeling + planning as one multimodal
  autoregressive transformer), 4D occupancy forecasting, World4Drive,
  ExploreVLA.

**What "end-to-end" actually means here:** _not_ one monolithic net.
UniAD keeps perception / prediction / planning as **distinct modules with
explicit intermediate representations** (a tracked-object list, an
occupancy grid, a map) — trained jointly. The temporal / world state is a
_named module_, not an emergent property.

**Where the analogy holds for computer use:**

- A dedicated **world-state module** carrying temporal information
  (tracked UI objects, their motion, recent state transitions) — yes,
  this is where GUI world models (§2.5) are heading.
- **Hierarchy** — perception/planning/control as stages — yes (§2.7).
- **Collocation** — inference near the sensor — yes, for latency (§2.11).

**Where it breaks:**

- **Action space.** FSD: {steer, accelerate, brake} — 3 continuous
  dimensions. Computer use: unbounded, per-application, discrete +
  continuous.
- **Data.** FSD: billions of _homogeneous_ fleet miles. Computer use:
  the whole point of CUA-Gym / VideoCUA is that this data barely exists
  yet.
- **Why FSD is real-time at all.** Safety-criticality _forces_ the
  millisecond loop and _pays for_ the dedicated silicon. Most computer
  tasks are not reflex-time; the economic case for 60 FPS control is
  weak _except_ for the minority class (games, drag, video scrubbing,
  reacting to animation) the blog correctly identifies.

**Net:** FSD is a good _intuition pump_ for "temporal world state +
hierarchy + collocation", and a _bad literal template_ because computer
use has neither a bounded action space nor fleet-scale data nor a
safety mandate.

---

## 4. The VLA connection (pillar 5)

- **OpenVLA** (7B, 970k Open-X episodes): robot actions as **discrete
  tokens** — each action dimension binned into vocab tokens the LLM
  predicts. Structurally _identical_ to how a GUI agent emits
  `click(x,y)` / `type(...)` tokens.
- **π0 / π0-FAST** (Physical Intelligence): PaliGemma VLM + a 300M
  diffusion "action expert", continuous actions via flow matching.
- Two paradigms — discrete-token vs continuous-diffusion — and 2026 work
  (Unified Diffusion VLA, Residual RL for VLAs) is merging them.

**Assessment:** "GUI agent is structurally a VLA" is _true_ — same
vision→language→action shape, same discrete-token action option. The
_robot transfer_ claim (train on GUIs, deploy on a robot arm) has **no
published demonstration** and faces the embodiment gap (a mouse cursor is
not a 7-DoF arm). But **"the action space is the portable interface"** is
a sound design principle regardless: design the Controller's primitives
as if they might one day drive something physical, and you get a clean,
model-agnostic boundary today.

---

## 5. The vision vs. the field — verdict per pillar

| #   | Blog claim                    | 2026 verdict                                                                                                                                                                                                                                                   |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Video, not screenshots        | **Vindicated as a research direction.** VideoCUA/CUA-Suite build the data; LivingScreen benchmarks it; "continuous video is the missing ingredient" is a stated consensus. _Still_ no shipped video-native GUI operator. Screenshot loops dominate production. |
| 2   | The loop is too slow          | **Correct and central.** 2.7–4.3× step overhead, tens-of-minutes latency, "practically unusable" — the field's own words. Active fixes: speculative execution (−45%), pre-warmed sandboxes, trace→code caching, small grounding models, hierarchy.             |
| 3   | FSD is the proof              | **Good intuition, bad literal template** (see §3). Adopt: world-state module, hierarchy, collocation. Reject: monolithic end-to-end, 60 FPS everywhere.                                                                                                        |
| 4   | Neighbourhood-scale inference | **Right idea (edge/collocation), wrong scale for a desktop app.** Realistic form: INT4 VLM on the homelab over Tailscale. Affordable today (§2.11).                                                                                                            |
| 5   | Motor primitives → robots     | **Half true.** GUI-agent-as-VLA is structurally real (discrete action tokens); robot transfer is undemonstrated. "Action space as portable interface" is worth designing for anyway.                                                                           |

Plus one the blog _implied_ and the field has since named explicitly:
**observation control** — the agent deciding _when and where to look_ is a
first-class capability, and current frontier models are bad at it
(over/under-observation is the dominant LivingScreen failure).

---

## 6. What Actovia should build

**Actovia will not out-model the frontier labs.** It _can_ be the best
open **operator harness**: model-agnostic, fully sandboxed, and — uniquely
— **fully traced** (every episode is one `traceId` in the logging system
shipped this week; every step a structured log line). When the next
model ships a better computer-use API, you swap the Agent and the Runtime
is untouched. That is the moat, and it matches the field's own lesson
that _environments and data_, not model weights, are the bottleneck.

### The `Computer Runtime` module, staged

| Phase            | Capture                                                     | Perception                                                   | Temporal                                                    | Controller                                       | Agent                                                                 |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| **1** (~1–2 wk)  | `desktopCapturer`, one window **or a VM**, ~2 FPS on demand | screenshot only                                              | `{prevScreenshot, actionLog[]}`                             | execute one action (`nut.js`), no inner loop     | Claude computer-use format (best-documented); UI-TARS as local option |
| **2**            | +change flag                                                | +cheap pixel/OCR diff → "what changed" text                  | rolling change list, N-back                                 | still one-shot                                   | + Astra / model switch                                                |
| **3**            | —                                                           | **three-eye**: DOM (web) + a11y + screenshot; SoM for coords | UI-object tracking (id, bounds, state)                      | ROI cropping before VLM                          | —                                                                     |
| **4**            | 15–30 FPS ring buffer                                       | local keyframe engine (Event-VStream-style)                  | **World State** JSON: objects, changes, trajectory, history | inner loop: "go to Settings" not `move(1241,83)` | L2 called 0.1–2×/s                                                    |
| **5** (research) | —                                                           | streaming VLM on the homelab for a _specific_ task class     | learned temporal model (SSM)                                | continuous cursor control, action chunking       | —                                                                     |

**Design rules pulled from the survey:**

- Agent↔Controller interface is **declarative** (§2.4); motor primitives
  live _inside_ the Controller.
- `observe()` returns _best-available signal_, not a fixed rich schema —
  web gets DOM, native macOS often just a screenshot.
- Don't build the World Model / "visual git" before Phase 3 has shown a
  plain `{prev screenshot + action log}` isn't enough. Earn it with data.
- V0 target is **a VM or a single scoped window**, never the live
  desktop (§2.10). Every action behind the existing permission gate.
- History compression (VERA / AgentOCR-style) becomes necessary around
  Phase 3–4, not before.
- L1 local model = Qwen2.5-VL-7B INT4 on the homelab GPU box over
  Tailscale (§2.11), not a Mac Mini.

---

## 7. If this becomes a paper

Actovia's credible contribution is **systems + measurement**, not a new
model:

1. **A model-agnostic, fully-traced operator harness** — architecture,
   the `observe()` best-available-signal abstraction, the
   declarative Agent↔Controller boundary, and the trace schema that makes
   every episode replayable.
2. **An honest latency/efficiency breakdown** of the loop across models
   (Astra vs Claude vs local UI-TARS) on the _same_ harness — step
   count, wall-clock, token cost, per phase. The field keeps reporting
   these in isolation; a controlled cross-model comparison on one harness
   is publishable.
3. **The homelab-collocation experiment** — does moving the grounding
   model from cloud to a Tailscale-local INT4 VLM actually change the
   loop's usability? Measured, with numbers.
4. **Observation-control as a Runtime concern** — a keyframe/diff engine
   that decides _when to invoke the expensive model_, evaluated on
   over/under-observation (LivingScreen-style) and on cost.

None of these need frontier compute. All of them need exactly what Actovia
is: a real app, multiple models, real users, and good instrumentation.

---

## 8. Open questions for the user

1. **Phase 1 target** — a disposable VM (safe to run unattended) or a
   single scoped app window (lighter, but you must be watching)?
2. **First Agent** — Claude computer-use (reference-quality docs, safest
   starting point), GPT-6 Astra (SOTA, pricey, async API), or UI-TARS
   local (open, weaker, self-host)?
3. **Is the homelab-collocation path (Phase 4–5) a real goal**, or does
   cloud inference stay the default and "collocated" remains a research
   probe?
4. **Paper or no paper** — if yes, which of the four angles in §7 is the
   one you actually care about? That choice changes what Phase 1 needs to
   instrument from day one.
5. Ready to take Phase 1 into `brainstorming` for a spec, or keep this in
   research mode longer?

---

## Appendix — bibliography by theme

**Models / products:** GPT-6 Astra ([openai.com](https://openai.com/index/gpt-6-astra/)) ·
Claude Sonnet/Opus 5 ([anthropic.com](https://www.anthropic.com/news/claude-sonnet-4-6)) ·
Gemini 2.5 Computer Use ([blog.google](https://blog.google/innovation-and-ai/models-and-research/google-deepmind/gemini-computer-use-model/)) ·
UI-TARS-2 ([2509.02544](https://arxiv.org/abs/2509.02544)) ·
Anthropic computer-use tool ([platform.claude.com](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool))

**Benchmarks:** OSWorld 2.0 ([2606.29537](https://arxiv.org/abs/2606.29537)) ·
OSWorld-Human ([2506.16042](https://arxiv.org/abs/2506.16042)) ·
MCPWorld ([2506.07672](https://arxiv.org/abs/2506.07672)) ·
LivingScreen ([2606.04701](https://arxiv.org/abs/2606.04701)) ·
GUI-360° ([2511.04307](https://arxiv.org/pdf/2511.04307)) ·
MMBench-GUI ([2507.19478](https://arxiv.org/pdf/2507.19478))

**Perception / grounding:** UGround ([2410.05243](https://arxiv.org/html/2410.05243v1)) ·
GUI-Actor / coordinate-free · InnerZoom ([2606.30084](https://arxiv.org/html/2606.30084)) ·
GUI-G² ([2507.15846](https://arxiv.org/pdf/2507.15846)) ·
"Do GUI Agents Believe Their Eyes?" ([2607.04334](https://arxiv.org/html/2607.04334)) ·
WinDOM ([2606.25964](https://arxiv.org/pdf/2606.25964))

**Action space:** DMI / imperative→declarative ([2510.04607](https://arxiv.org/html/2510.04607v2)) ·
UltraCUA ([2510.17790](https://arxiv.org/abs/2510.17790)) ·
CoAct-1 ([2508.03923](https://arxiv.org/abs/2508.03923)) ·
"Screenshots or Tools?" ([2608.03327](https://arxiv.org/html/2608.03327))

**Temporal / memory / world models:** Mem-W ([2605.09317](https://arxiv.org/html/2605.09317v1)) ·
MementoGUI ([2605.18652](https://arxiv.org/pdf/2605.18652)) ·
Executable Agentic Memory ([2605.12294](https://arxiv.org/html/2605.12294)) ·
"Naive Visual Memory is Not Enough" ([2606.14106](https://arxiv.org/pdf/2606.14106)) ·
Agentic World Modeling ([2604.22748](https://arxiv.org/pdf/2604.22748)) ·
VERA / AgentOCR ([2601.04786](https://arxiv.org/html/2601.04786)) ·
HiconAgent ([2512.01763](https://arxiv.org/html/2512.01763)) ·
"When History Is Multimodal" ([2608.29897](https://arxiv.org/html/2608.29897))

**Streaming / video-native:** StreamingVLM ([2510.09608](https://arxiv.org/abs/2510.09608)) ·
Event-VStream ([2601.15655](https://arxiv.org/pdf/2601.15655)) ·
StreamArena ([2608.05703](https://arxiv.org/abs/2608.05703)) ·
VideoCUA / CUA-Suite ([2603.24440](https://arxiv.org/html/2603.24440)) ·
"High-Dynamic Environments" ([2604.25380](https://arxiv.org/html/2604.25380v1)) ·
action-chunking continuation ([2602.12978](https://huggingface.co/papers/2602.12978)) ·
[awesome-streaming-agents](https://github.com/lg-li/awesome-streaming-agents)

**Hierarchy / control:** CODA ([2508.20096](https://arxiv.org/abs/2508.20096)) ·
Agent S2 ([2504.00906](https://arxiv.org/abs/2504.00906)) ·
Hierarchical Recovery ([2606.20487](https://arxiv.org/pdf/2606.20487)) ·
PEAR ([2510.07505](https://arxiv.org/pdf/2510.07505))

**Latency / efficiency:** Speculative Macro Commit ([2609.03236](https://arxiv.org/abs/2609.03236)) ·
SpecBox ([2607.23933](https://arxiv.org/html/2607.23933)) ·
Agent JIT ([2605.21470](https://arxiv.org/html/2605.21470)) ·
Step-level Optimization ([2604.27151](https://arxiv.org/pdf/2604.27151)) ·
Dynamic Speculative Agent Planning ([2509.01920](https://arxiv.org/pdf/2509.01920))

**Training environments:** CUA-Gym ([2605.25624](https://arxiv.org/abs/2605.25624)) ·
OpenComputer ([2605.19769](https://arxiv.org/pdf/2605.19769)) ·
DreamGym ([2511.03773](https://arxiv.org/pdf/2511.03773)) ·
PhoneBuddy ([2606.23049](https://arxiv.org/pdf/2606.23049))

**Security:** "JARVIS or Ultron?" ([2505.10924](https://arxiv.org/pdf/2505.10924)) ·
ceLLMate ([2512.12594](https://arxiv.org/pdf/2512.12594)) ·
Untrusted Content Masking ([2607.05277](https://arxiv.org/pdf/2607.05277)) ·
"Blind Spot of Agent Safety" ([2604.10577](https://arxiv.org/pdf/2604.10577)) ·
Architecture-Lifecycle Framework ([2605.07110](https://arxiv.org/pdf/2605.07110))

**VLA:** OpenVLA ([github](https://github.com/openvla/openvla)) · π0 (Physical Intelligence) ·
"VLAs are Confined yet Capable" ([2505.03500](https://arxiv.org/pdf/2505.03500)) ·
Embodied Operators ([2607.03283](https://arxiv.org/pdf/2607.03283))

**Autonomous driving reference:** UniAD · GAIA-1 · DrivingGPT ([2412.18607](https://arxiv.org/pdf/2412.18607)) ·
4D Occupancy World ([2408.14197](https://arxiv.org/pdf/2408.14197)) ·
Latent World Model for E2E driving ([2406.08481](https://arxiv.org/pdf/2406.08481))

**Self-hosting:** Bench360 ([2511.16682](https://arxiv.org/html/2511.16682v1)) ·
Private LLM inference on consumer Blackwell ([2601.09527](https://arxiv.org/html/2601.09527))
