# Actovia

![Actovia](./screenshots/screenshots.jpg)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Factovia-ai%2Factovia.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Factovia-ai%2Factovia?ref=badge_shield)

[![CodeQL](https://github.com/actovia-ai/actovia/actions/workflows/github-code-scanning/codeql/badge.svg?branch=master)](https://github.com/actovia-ai/actovia/actions/workflows/github-code-scanning/codeql)
[![Release](https://github.com/actovia-ai/actovia/actions/workflows/release.yml/badge.svg)](https://github.com/actovia-ai/actovia/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Code Style](https://img.shields.io/badge/Code%20Style-oxfmt-blue)](https://oxc.rs/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/actovia-ai/actovia/pulls)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D22-brightgreen.svg)](https://nodejs.org/en/)
[![Chat](https://img.shields.io/badge/Chat-Discord-blue?style=flat&logo=discord)](https://discord.gg/G7sM9AEMj)
![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/actovia-ai/actovia?utm_source=oss&utm_medium=github&utm_campaign=actovia-ai%2Factovia&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

## Introduction

Actovia (formerly Exodus) is a high-performance, cross-platform AI chat application for desktop that is compatible with a variety of model providers. It runs a full local backend — an embedded Postgres database (PGlite + pgvector), a Hono HTTP server, and a durable job queue — so features like retrieval, memory consolidation, and multi-agent runs happen on your machine.

## LLM Providers

> [!NOTE]
> Actovia tracks provider model lists as they change; the table below reflects the current defaults. Any provider's model list can also be extended in settings.

| Provider         | Chat Models                                                                   | Reasoning Models                   |
| ---------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| OpenAI GPT       | gpt-5.5, gpt-5.5-pro, gpt-5.4, gpt-5.4-pro/mini/nano                          | gpt-5.5-pro, gpt-5.5, gpt-5.4-pro  |
| Azure OpenAI     | gpt-5.5, gpt-5.5-pro, gpt-5.4, gpt-5.4-pro/mini/nano                          | gpt-5.5-pro, gpt-5.5, gpt-5.4-pro  |
| Google Gemini    | gemini-3.1-pro, gemini-3-flash, gemini-3.1-flash-lite, gemini-2.5-flash/-lite | gemini-3.1-pro, gemini-2.5-pro     |
| xAI Grok         | grok-4.3, grok-4.1-fast, grok-4, grok-code-fast-1                             | grok-4.3, grok-4                   |
| Anthropic Claude | claude-opus-4-8, claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5         | claude-opus-4-8, claude-sonnet-4-6 |
| Ollama           | Based on your own Ollama service                                              | Based on your own Ollama service   |

## Core Features

### Daily Chat

A natural, multi-turn chat experience across every supported provider, with multi-step tool use, streaming responses, and Artifacts (a live side panel for generated code, documents, and web pages).

### Deep Research

Analyzes your query and research parameters (breadth and depth), generates follow-up questions to refine intent, then runs a recursive search process — issuing multiple queries, extracting insights, and identifying new directions while keeping context. It compiles everything into a structured, source-cited Markdown report.

### Knowledge Base (RAG)

An optional retrieval layer backed by a self-hosted [LightRAG](https://github.com/HKUDS/LightRAG) server (Actovia is a client only — see `docs/lightrag-setup.md`). Documents you add in settings are indexed into LightRAG; retrieval is context-only, and Actovia's own model writes the answer.

### Philharmonic — multi-agent Groups

Teams of agents that collaborate on a task. Each Group runs in an isolated workspace, has per-agent memory and tools, and supports scheduled (recurring or one-off) runs managed from the dashboard.

### Memory & Personalization

A durable, topic-consolidated memory of you. After each turn a single model call reconciles the conversation against the existing memory index; pre-turn, relevant entries are selected and rendered into the system prompt.

### Computer Use (macOS)

The AI operates a single application window with a virtual mouse and keyboard — it sees a screenshot each step and acts like a person (move, click, drag, scroll, type, key chords). Window-scoped and gated by an allowlist of apps you choose; it opens an allowlisted app that isn't running, and you can stop it any time with `⌥⇧⎋`. Every session is fully traced. Requires macOS Screen Recording + Accessibility permissions.

### App Lock

A local PIN lock that gates the whole app and every API call. The encrypted secret uses scrypt + Electron `safeStorage`; unlock happens only on the lock screen, never over HTTP.

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

Since Actovia is not available on the App Store, you may encounter the following issue when you open it for the first time. Please follow the steps below to resolve it:

![cant-be-open-in-macos](./screenshots/cannot-be-open-in-macos.png)

1. Move `Actovia.app` to the `/Applications` directory.
2. Open your terminal app and execute the command `chmod +x /Applications/Actovia.app/Contents/MacOS/Actovia`.

## Developing Actovia

### Prerequisites

We have chosen [Electron](https://www.electronjs.org/) as our cross-platform framework, built with [Electron Forge](https://www.electronforge.io/) and [Vite](https://vite.dev/). Make sure that [Bun](https://bun.sh/) is installed on your system, then run `bun install`.

### Available Scripts

| Command                     | Description                                                           |
| --------------------------- | --------------------------------------------------------------------- |
| `bun run dev`               | Start the app in development (Vite dev servers, hot reload)           |
| `bun run package`           | Package the app for the current platform into `out/`                  |
| `bun run make`              | Build distributables (macOS ZIP/DMG, Windows Squirrel, Linux deb/rpm) |
| `bun run build:helper`      | Build the `exodus-input` helper for Computer Use (macOS, needs Xcode) |
| `bun run test`              | Run unit tests (Vitest)                                               |
| `bun run test:watch`        | Run tests in watch mode                                               |
| `bun run test:coverage`     | Run tests with coverage report                                        |
| `bun run test:e2e:electron` | Package the app, then run the Playwright Electron end-to-end tests    |
| `bun run typecheck`         | Run TypeScript type checking (main, renderer and the shared package)  |
| `bun run lint`              | Run oxlint (fast Rust-based linter)                                   |
| `bun run lint:fix`          | Run oxlint with auto-fix                                              |
| `bun run fmt`               | Format code with oxfmt (fast Rust-based formatter)                    |
| `bun run fmt:check`         | Check formatting without modifying files                              |
| `bun run i18n:check`        | Verify translation catalogs are complete across all locales           |

Development builds use your real data directory, `~/.exodus` — see [CLAUDE.md](./CLAUDE.md) for the details, and don't run two Actovia processes on it at once.

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

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Factovia-ai%2Factovia.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2Factovia-ai%2Factovia?ref=badge_large)
