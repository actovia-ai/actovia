# Actovia Contributing Guide

Hi! We are really excited that you are interested in contributing to Actovia. Before submitting your contribution, please make sure to take a moment and read through the following guide:

## Repo Setup

Actovia is an Electron app built on [electron-forge](https://www.electronforge.io/) + Vite + React.

```bash
bun install
bun run dev      # launch the app in dev mode
bun run lint       # oxlint
bun run fmt:check  # oxfmt
bun run typecheck  # tsc, split across main/preload, renderer, and packages/shared
bun run test       # vitest
```

## Pull Request Guidelines

- Checkout a topic branch from a base branch, e.g. `master`, and merge back against that branch.

- If adding a new feature:
  - Add accompanying test case.
  - Provide a convincing reason to add this feature. Ideally, you should open a suggestion issue first and have it approved before working on it.

- If fixing bug:
  - If you are resolving a special issue, add `(fix #xxxx[,#xxxx])` (#xxxx is the issue id) in your PR title for a better release log, e.g. `fix: update entities encoding/decoding (fix #3899)`.
  - Provide a detailed description of the bug in the PR. Live demo preferred.
  - Add appropriate test coverage if applicable.

- It's OK to have multiple small commits as you work on the PR - GitHub can automatically squash them before merging.

- Make sure tests pass!

- Commit messages should follow the [Angular Team's Commit Message Guidelines](https://github.com/angular/angular/blob/master/CONTRIBUTING.md#commit) so that changelogs can eventually be generated from them.
- No need to worry about code style as long as you have installed the dev dependencies - staged files are automatically linted and formatted with oxlint/oxfmt on commit.
