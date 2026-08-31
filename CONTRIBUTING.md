# Contributing to Krida

Thanks for your interest in contributing. This guide covers local setup and what CI expects.

## Prerequisites

- Node.js 24 (matches CI)
- npm

## Setup

```sh
git clone https://github.com/elvisdsz/krida.git
cd krida
npm install
```

`@mediapipe/tasks-vision` is a peer dependency and is installed automatically for local development.

## Trying your changes

Krida targets the browser and needs a webcam, so changes are verified manually through the sandbox. See [`sandbox/README.md`](sandbox/README.md) for how to build and run it.

## Before you push

Run the same checks CI runs:

```sh
npm run format
npm run typecheck
npm run build
```

CI runs `format:check`, `typecheck`, and `build` on both Ubuntu and Windows, for every push to `main` and every pull request. All three must pass.

## Formatting

Prettier owns all formatting — please don't hand-format. Configuration lives in `.prettierrc`.

- `npm run format` rewrites files in place
- `npm run format:check` reports problems without changing anything (this is what CI runs)

Most editors can run Prettier on save. In VS Code, install the Prettier extension; it picks up the workspace config and the locally pinned Prettier version automatically.

Prettier is pinned to an exact version so that formatting output is identical for everyone. Please don't upgrade it as part of an unrelated change.

## Line endings

`.gitattributes` normalizes the repository to LF. You don't need to configure `core.autocrlf` — the repository settings take precedence on every platform.

## Optional: cleaner `git blame`

The codebase was reformatted in a single commit, which would otherwise dominate `git blame` output. GitHub's blame view ignores it automatically. To get the same behaviour on the command line:

```sh
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Pull requests

Open pull requests against `main`. Please keep formatting-only changes separate from functional changes so that diffs stay reviewable.
