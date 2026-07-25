# DevBox

A developer's Swiss Army knife for the desktop: a notes/snippets manager, plus utilities
(hashing, encoding, formatting) to come.

**Angular 22** (standalone components, signals, zoneless change detection) on the front,
**Rust / Tauri v2** as the native shell.

> **Status** — the notes UI is built and interactive, but runs on in-memory mock data:
> nothing is persisted yet. The Rust side is still the Tauri scaffold plus a demo command.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ and npm
- [Rust](https://www.rust-lang.org/tools/install) (via `rustup`)
- Tauri's system dependencies for your OS — see the
  [Tauri prerequisites](https://tauri.app/start/prerequisites/)

## Getting started

```bash
npm install          # also needed before the first Rust build: Tauri's build script reads the front-end config
npm run tauri dev    # Angular dev server + Tauri window
```

Front-end changes hot-reload; Rust changes trigger an automatic (slower) recompile.

To work on the UI alone, `npm start` serves the app on http://localhost:1420 — it runs fine
in a plain browser, since nothing calls a Tauri API at runtime yet.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Angular dev server only, port 1420 |
| `npm run tauri dev` | Full dev loop: Angular dev server + Tauri window |
| `npm run build` | Production Angular build → `dist/devbox/browser` |
| `npm run tauri build` | Full production build → `src-tauri/target/release` |
| `npm test` | Unit tests (Vitest, jsdom — no browser required) |
| `npm run test:watch` | Tests, re-running on change |
| `npm run test:coverage` | Tests with a v8 coverage report |

For Rust-only iteration, `cargo check` from `src-tauri/` is much faster than a full
`tauri build`.

## Layout

```
src/          Angular front-end (core/ state & data, features/ screens, layout/, shared/)
src-tauri/    Rust back-end: Tauri config, capabilities, commands/
docs/         Architecture notes and UI mockup
```

## Documentation

- [Architecture](docs/architecture.md) — front-end structure, state and data-access
  patterns, i18n, theming, the Angular ↔ Rust IPC boundary, and testing conventions.
- [`docs/scratch-mockup-v2.html`](docs/scratch-mockup-v2.html) — static UI mockup used as
  the visual reference. Not code to run or import.

## Roadmap

- [x] Notes UI: spaces, search, filters, tag rail, pinned/today/week sections, editor
      overlay with code viewer
- [x] French/English localization with persisted locale
- [ ] Persistence: real Rust notes backend behind the `NOTES_REPOSITORY` token
- [ ] Editable note content (the overlay is read-only apart from title and pin)
- [ ] Real spaces — currently a mock list that doesn't filter anything
- [ ] `crypto` module: SHA-256, MD5, UUID generation
- [ ] `formatters` module: base64 encode/decode, JSON formatting
- [ ] Linting/formatting setup and Rust tests

## Conventions

Code comments, docstrings and UI strings are written in **French**. Test descriptions and
test comments are in **English**, matching Vitest/Angular community conventions.

No linter or formatter is configured yet (no ESLint, Prettier, clippy or rustfmt hook).

## Recommended IDE setup

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) + [Angular Language Service](https://marketplace.visualstudio.com/items?itemName=Angular.ng-template),
or JetBrains RustRover / WebStorm.