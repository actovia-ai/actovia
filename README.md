# Actovia

<img width="3840" height="2560" alt="search-3840x2560" src="https://github.com/user-attachments/assets/465fd071-87f6-46e2-83dd-d4106002d01a" />

[![CodeQL](https://github.com/actovia-ai/actovia/actions/workflows/github-code-scanning/codeql/badge.svg?branch=master)](https://github.com/actovia-ai/actovia/actions/workflows/github-code-scanning/codeql)
[![Release](https://github.com/actovia-ai/actovia/actions/workflows/release.yml/badge.svg)](https://github.com/actovia-ai/actovia/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Code Style](https://img.shields.io/badge/Code%20Style-oxfmt-blue)](https://oxc.rs/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/actovia-ai/actovia/pulls)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D22-brightgreen.svg)](https://nodejs.org/en/)
[![Chat](https://img.shields.io/badge/Chat-Discord-blue?style=flat&logo=discord)](https://discord.gg/G7sM9AEMj)
![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/actovia-ai/actovia?utm_source=oss&utm_medium=github&utm_campaign=actovia-ai%2Factovia&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

## Introduction

Actovia is a high-performance, cross-platform AI chat application for desktop that is compatible with a variety of model providers. It runs a full local backend — an embedded Postgres database (PGlite + pgvector), a Hono HTTP server, and a durable job queue — so features like retrieval, memory consolidation, and multi-agent runs happen on your machine.

[Website & docs](https://actovia.yancey.app) · [Desktop downloads](https://github.com/actovia-ai/actovia/releases/latest) · [iPhone & iPad app](https://apps.apple.com/app/actovia/id6824829679) · [CLI](https://github.com/actovia-ai/cli)

Your chats stay on the computer running Actovia. Bring your own model keys; messages and tool requests are sent to the providers and services you choose. The iOS app pairs with that computer over a certificate-pinned connection; it is a companion, so the computer must be awake and Actovia must be running.

## LLM Providers

> [!NOTE]
> Actovia tracks provider model lists as they change; the table below reflects the current defaults. Any provider's model list can also be extended in settings.

| Provider                              | Configuration                                                               |
| ------------------------------------- | --------------------------------------------------------------------------- |
| OpenAI, Anthropic, Google Gemini, xAI | Add your API key in Settings → Providers; refresh the model list there.     |
| Azure OpenAI                          | Configure your endpoint, deployment/model and API version.                  |
| Ollama                                | Point Actovia at your Ollama service; its installed models are listed live. |

Model availability follows each provider and your account. Custom model IDs and compatible base URLs can be configured in Settings.

## Core Features

### Daily Chat

A natural, multi-turn chat experience across every supported provider, with multi-step tool use, streaming responses, and Artifacts (a live side panel for generated code, documents, and web pages).

### Deep Research

Analyzes your query and research parameters (breadth and depth), generates follow-up questions to refine intent, then runs a recursive search process — issuing multiple queries, extracting insights, and identifying new directions while keeping context. It compiles everything into a structured, source-cited Markdown report.

### Knowledge Base (RAG)

An optional retrieval layer backed by a self-hosted [LightRAG](https://github.com/HKUDS/LightRAG) server (Actovia is a client only — see `docs/lightrag-setup.md`). Documents you add in settings are indexed into LightRAG; retrieval is context-only, and Actovia's own model writes the answer.

### Philharmonic — multi-agent Groups

A PM coordinates employees, teams and plans in isolated Group workspaces. Follow progress, answer an employee that is waiting for permission, and inspect sources, files and decisions. Claude Code and Codex employees can use their own CLI sessions and quota reporting. Group icons are editable from the sidebar's context menu.

### Scheduled tasks

The global **Scheduled** page shows Chat and Philharmonic tasks together. Use the bottom composer to describe a task and continue in Chat; examples help you get started. Create, edit, pause and delete Chat schedules through conversation. Group schedules remain managed by the PM. Actovia must be running on the computer for schedules to fire, using that computer's time zone.

### iPhone, iPad and Health

Get the [native companion](https://apps.apple.com/app/actovia/id6824829679), then pair it from Settings → Devices. Continue the same chats, control Philharmonic and read reports. The Health workspace uses Apple Health on the phone, with permission, and attaches selected summaries when you ask the assistant; those summaries go to your computer and configured model provider. Wide windows keep the sidebar beside a readable chat column, including the iPhone Duo layout.

### Accessibility and appearance

Twelve interface languages, light/dark/system appearance, colour tones, and Settings → General → Reduce motion. With the switch off, motion still follows the system's accessibility setting.

### Memory & Personalization

A durable, topic-consolidated memory of you. After each turn a single model call reconciles the conversation against the existing memory index; pre-turn, relevant entries are selected and rendered into the system prompt.

### Computer Use (macOS)

The AI operates a single application window with a virtual mouse and keyboard — it sees a screenshot each step and acts like a person (move, click, drag, scroll, type, key chords). Window-scoped and gated by an allowlist of apps you choose; it opens an allowlisted app that isn't running, and you can stop it any time with `⌥⇧⎋`. Every session is fully traced. Requires macOS Screen Recording + Accessibility permissions.

### App Lock

A local PIN lock that gates the whole app and every API call. The encrypted secret uses scrypt + Electron `safeStorage`; the desktop lock screen unlocks locally, paired devices can request an unlock using their authenticated connection, and the CLI uses a short-lived PIN-authenticated pass.

### Lossless Context Management

Compacts long conversations without losing information — the agent gets summaries it can expand or grep on demand, so nothing is silently dropped.

### Home Discover

An optional home-screen feed of topics drawn from your memory, refreshed from [Brave News](https://brave.com/search/api/). Off by default; renders nothing until you opt in.

### Built-in Calling Tools

| Tool                                                | Notes                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| Web Search / Weather / Google Maps routing & places | via [Serper](https://serper.dev/) — needs a Serper API key in settings       |
| Web Fetch                                           | fetch and read a URL as clean text                                           |
| Knowledge Base search                               | queries the LightRAG index (see above)                                       |
| File tools                                          | read / write / edit / grep / find / list-directory within a scoped workspace |
| Terminal                                            | run a shell command                                                          |
| Computer Use                                        | drive an allowlisted macOS app window (see above)                            |
| Image Generation                                    | OpenAI only                                                                  |
| Create Artifact                                     | render code / a document / a web page into the side panel                    |

### Audio and Speech

Text-to-speech and speech-to-text (OpenAI only). Configure the OpenAI API settings before using these.

### MCP

Model Context Protocol servers can be configured in settings to expose external tools to the agent (automatic startup connection is currently archived).

### Cross-Platform

Built on Electron for a consistent experience across macOS, Windows, and Linux. Computer Use is macOS-only.

## Getting Started with Actovia

You can download Actovia from our [homepage](https://actovia.yancey.app) or manually from [GitHub Releases](https://github.com/actovia-ai/actovia/releases/).

We always keep the developer tools (e.g., <kbd>Command</kbd> + <kbd>Option</kbd> + <kbd>I</kbd>) open in the production environment. In Actovia, everything is transparent and controllable.

### macOS

Download the current Developer ID signed and notarized release, open the disk image and move `Actovia.app` to `/Applications`. Developer builds without signing credentials remain ad-hoc; they are intended for development and do not have the release's trust or automatic-update behavior. See the [installation guide](https://actovia.yancey.app/docs/installation).

## Developing Actovia

### Prerequisites

We have chosen [Electron](https://www.electronjs.org/) as our cross-platform framework, built with [Electron Forge](https://www.electronforge.io/) and [Vite](https://vite.dev/). Make sure that [Bun](https://bun.sh/) is installed on your system, then run `bun install`.

### Available Scripts

| Command                     | Description                                                            |
| --------------------------- | ---------------------------------------------------------------------- |
| `bun run dev`               | Start the app in development (Vite dev servers, hot reload)            |
| `bun run package`           | Package the app for the current platform into `out/`                   |
| `bun run make`              | Build distributables (macOS ZIP/DMG, Windows Squirrel, Linux deb/rpm)  |
| `bun run build:helper`      | Build the `actovia-input` helper for Computer Use (macOS, needs Xcode) |
| `bun run test`              | Run unit tests (Vitest)                                                |
| `bun run test:watch`        | Run tests in watch mode                                                |
| `bun run test:coverage`     | Run tests with coverage report                                         |
| `bun run test:e2e:electron` | Package the app, then run the Playwright Electron end-to-end tests     |
| `bun run typecheck`         | Run TypeScript type checking (main, renderer and the shared package)   |
| `bun run lint`              | Run oxlint (fast Rust-based linter)                                    |
| `bun run lint:fix`          | Run oxlint with auto-fix                                               |
| `bun run fmt`               | Format code with oxfmt (fast Rust-based formatter)                     |
| `bun run fmt:check`         | Check formatting without modifying files                               |
| `bun run i18n:check`        | Verify translation catalogs are complete across all locales            |

Development builds use your real data directory, `~/.actovia` — see [CLAUDE.md](./CLAUDE.md) for the details, and don't run two Actovia processes on it at once.

## Contributing

The main purpose of this repository is to continue to evolve Actovia, making it faster and easier to use. The development of Actovia happens in the open on GitHub, and we are grateful to the community for contributing bug fixes and improvements. Read below to learn how you can take part in improving Actovia.

### [Code of Conduct](./CODE_OF_CONDUCT.md)

Actovia has adopted a Code of Conduct that we expect project participants to adhere to. Please read the [full text](./CODE_OF_CONDUCT.md) so that you can understand what actions will and will not be tolerated.

### [Contributing Guide](./CONTRIBUTING.md)

Read our [contributing guide](./CONTRIBUTING.md) to learn about our development process, how to propose bug fixes and improvements, and how to build and test your changes to Actovia.

### Good Issues

Please make sure to read the [Issue Reporting Checklist](./.github/ISSUE_TEMPLATE/bug_report.md) before opening an issue. Issues not conforming to the guidelines may be closed immediately.

## Discussions

If you have any questions or feedback about Actovia, please visit our [official discussion forum](https://github.com/actovia-ai/actovia/discussions) to start a conversation with our team or other users. We are committed to making Actovia the best possible chat application, and your feedback plays a crucial role in achieving this goal.

## Acknowledgements

- The deep research feature is adapted from Dzhng's [deep-research](https://github.com/dzhng/deep-research).
- The fundamental chat SDK is based on the public template from Vercel's [ai-chatbot](https://github.com/vercel/ai-chatbot).

## License

Actovia is licensed under the terms of the [MIT License](https://opensource.org/licenses/MIT).

Brand sources, demo captures, App Store media and production scripts are maintained in [actovia-ai/assets](https://github.com/actovia-ai/assets). App builds use the generated images committed here; only icon regeneration needs the assets checkout.
