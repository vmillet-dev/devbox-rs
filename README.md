# DevBox

A developer's Swiss Army knife for the desktop: a notes/snippets manager, plus utilities
(hashing, encoding, formatting) to come.

**Angular 22** (standalone components, signals, zoneless change detection) on the front,
**Rust / Tauri v2** as the native shell.

> **Status** — the notes feature is complete end to end. The UI has no mock data left, every
> read and write crosses the `invoke()` bridge, and the Rust side persists to an embedded
> SQLite database. Business rules live in `src-tauri/src/domain/`, which depends on neither
> rusqlite nor Tauri. `crypto` and `formatters` are documented placeholders, not yet built.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ and npm
- [Rust](https://www.rust-lang.org/tools/install) (via `rustup`)
- Tauri's system dependencies for your OS — see the
  [Tauri prerequisites](https://tauri.app/start/prerequisites/)

## Getting started

```bash
npm install          # also needed before the first Rust build: Tauri's build script reads the front-end config
npm run tauri dev    # Vite dev server + Tauri window
```

Front-end changes hot-reload; Rust changes trigger an automatic (slower) recompile.

`npm start` serves the front-end alone on http://localhost:1420, but data loading needs the
Tauri runtime: outside the app window every `invoke()` fails and the notes canvas shows its
retry screen. Use it for pure styling work, `npm run tauri dev` for anything else.

## Scripts

| Command                 | What it does                                       |
| ----------------------- | -------------------------------------------------- |
| `npm start`             | Vite dev server only, port 1420                    |
| `npm run tauri dev`     | Full dev loop: Vite dev server + Tauri window      |
| `npm run build`         | Production build (Vite) → `dist/devbox/browser`    |
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
src/              Angular front-end (core/ state & data, features/ screens, layout/, shared/)
src-tauri/src/
  domain/         Model and business rules — knows neither SQLite nor Tauri
  storage/        SQLite persistence: SQL only, depends on domain/
  commands/       Tauri adapters: lock, delegate, translate the error
docs/             Architecture notes and UI mockup
```

Dependencies point one way: `commands/ → domain/ ← storage/`. Two greps keep it honest —
`grep -rn "rusqlite\|tauri::" src-tauri/src/domain/` and
`grep -rn "use crate::commands" src-tauri/src/storage/` must both come back empty.

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
- [x] Persistence: embedded SQLite (`rusqlite`, `bundled`) with versioned, append-only
      migrations
- [x] Business rules isolated in `src-tauri/src/domain/`, testable without a database
- [x] Rust tests, clippy (`deny(clippy::all)`) and rustfmt
- [ ] Renaming and deleting a space — needs a decision on what happens to its notes
- [ ] Moving a note between spaces (already expressible: `spaceId` is part of `NotePatch`)
- [ ] `crypto` module: SHA-256, MD5, UUID generation
- [ ] `formatters` module: base64 encode/decode, JSON formatting

## Conventions

Code comments, docstrings and UI strings are written in **French**. Test descriptions and
test comments are in **English**, matching Vitest/Angular community conventions.

The front-end is linted with ESLint (`angular-eslint`, including its template accessibility
rules) and formatted with Prettier — run `npm run lint` before pushing. The Rust side is
gated by `cargo clippy -- -D warnings` and `cargo fmt --check`; `unsafe_code` is forbidden
in `Cargo.toml`.

## Recommended IDE setup

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) + [Angular Language Service](https://marketplace.visualstudio.com/items?itemName=Angular.ng-template),
or JetBrains RustRover / WebStorm.
