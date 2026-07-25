# DevBox

A developer's Swiss Army knife for the desktop: a notes/snippets manager, plus utilities
(hashing, encoding, formatting) to come.

**Angular 22** (standalone components, signals, zoneless change detection) on the front,
**Rust / Tauri v2** as the native shell.

> **Status** — the notes UI is complete and fully wired to the Rust backend: there is no
> mock data left, every read and write goes through `invoke()`. The Rust commands are
> declared and registered but **their bodies are still to be written** — they return a
> "not implemented" error, so the app currently starts on its error/retry screen. See the
> TODOs in `src-tauri/src/commands/notes.rs` and `spaces.rs`.

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

`npm start` serves the front-end alone on http://localhost:1420, but data loading needs the
Tauri runtime: outside the app window every `invoke()` fails and the notes canvas shows its
retry screen. Use it for pure styling work, `npm run tauri dev` for anything else.

## Scripts

| Command                 | What it does                                       |
| ----------------------- | -------------------------------------------------- |
| `npm start`             | Angular dev server only, port 1420                 |
| `npm run tauri dev`     | Full dev loop: Angular dev server + Tauri window   |
| `npm run build`         | Production Angular build → `dist/devbox/browser`   |
| `npm run tauri build`   | Full production build → `src-tauri/target/release` |
| `npm test`              | Unit tests (Vitest, jsdom — no browser required)   |
| `npm run test:watch`    | Tests, re-running on change                        |
| `npm run test:coverage` | Tests with a v8 coverage report (80% thresholds)   |
| `npm run lint`          | ESLint + Prettier check                            |
| `npm run lint:fix`      | ESLint `--fix` + Prettier write                    |

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
- [x] Front-end IPC seam: typed `invoke()` wrapper, DTOs/mappers and Tauri repositories,
      wired as the app's only data source in `core/data/data.providers.ts`
- [x] Full note editing: content, format, tags, pin, deletion
- [x] Spaces: notes carry a `spaceId`, the switcher filters on it and can create a space
- [x] ESLint + Prettier, with template accessibility rules
- [ ] **Persistence: the bodies of the Rust commands** (`list_notes`, `create_note`,
      `update_note`, `delete_note`, `list_spaces`, `create_space`). Signatures, serde
      contract and per-function TODOs are in `src-tauri/src/commands/`
- [ ] Renaming and deleting a space — needs a decision on what happens to its notes
- [ ] Moving a note between spaces (already expressible: `spaceId` is part of `NotePatch`)
- [ ] `crypto` module: SHA-256, MD5, UUID generation
- [ ] `formatters` module: base64 encode/decode, JSON formatting
- [ ] Rust tests, clippy and rustfmt

## Conventions

Code comments, docstrings and UI strings are written in **French**. Test descriptions and
test comments are in **English**, matching Vitest/Angular community conventions.

The front-end is linted with ESLint (`angular-eslint`, including its template accessibility
rules) and formatted with Prettier — run `npm run lint` before pushing. The Rust side has no
clippy or rustfmt hook yet.

## Recommended IDE setup

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) + [Angular Language Service](https://marketplace.visualstudio.com/items?itemName=Angular.ng-template),
or JetBrains RustRover / WebStorm.
