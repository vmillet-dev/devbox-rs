# DevBox

A developer's Swiss Army knife for the desktop: a notes/snippets manager, plus utilities
(hashing, encoding, formatting) to come.

**Angular 22** (standalone components, signals, zoneless change detection) on the front,
**Rust / Tauri v2** as the native shell.

> **Status** — the notes feature is complete end to end. The UI has no mock data left, every
> read and write crosses the `invoke()` bridge, and the Rust side persists to an embedded
> SQLite database. Business rules live in each feature's `model.rs`, which depends on neither
> Diesel nor Tauri. `crypto` and `formatters` are documented placeholders, not yet built.

What it does today, beyond writing notes:

| Feature              | What it gives you                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------- |
| **Quick paste**      | `Ctrl+Alt+P` from anywhere: search a snippet, `Enter` copies it and the window steps aside   |
| **`{{fields}}`**     | `psql -h {{host}} -p {{port=5432}}` asks for its values before landing in the clipboard      |
| **Keyboard canvas**  | arrows to move, `Enter` open, `C` copy, `P` pin, `X` select, `Del` trash                     |
| **Trash**            | deleting is undoable, and reversible for 30 days                                             |
| **Bulk actions**     | select several notes, then move, tag, export or trash them in one go                         |
| **Tag management**   | rename, merge or drop a tag across the whole library                                         |
| **Attachments**      | drop a file on the editor or paste an image; open it, save it elsewhere, preview it inline   |
| **Import / export**  | a JSON bundle both ways — everything, one space, or the selection — with a report either way |
| **Copy as Markdown** | the selection rendered for a PR, a ticket or a chat message                                  |

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
src/              Angular front-end (core/ state & data, features/ screens, layout/, shared/)
src-tauri/src/
  notes/          The notes feature: model.rs, language.rs, view.rs, placeholder.rs,
                  trash.rs, store.rs
  spaces/         The spaces feature: model.rs, store.rs
  attachments/    The attachments feature: model.rs, store.rs (the bytes live on disk)
  transfer/       Import, export, share: the exchange format and the Markdown rendering
  db.rs           Connection, migrations, schema, stored-instant format
  error.rs        The three errors and the translation between them
  desktop.rs      Tray and global shortcuts — native glue, not a feature
docs/             Architecture notes and UI mockup
```

Both halves are filed by **subject**, not by technical nature. On the Rust side each feature
owns its model, its SQL and the commands that expose it: `<feature>.rs` holds the
`#[tauri::command]`s, `<feature>/model.rs` the rules, `<feature>/store.rs` the SQL. Deleting
`src-tauri/src/notes/` deletes the feature.

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
- [x] Persistence: embedded SQLite through Diesel (`libsqlite3-sys` `bundled`) with
      append-only, embedded migrations
- [x] Business rules isolated in each feature's `model.rs`, testable without a database
- [x] Rust tests, clippy (`deny(clippy::all)`) and rustfmt
- [x] Renaming and deleting a space, its notes moved to a refuge space in one transaction
- [x] Moving a note between spaces (`spaceId` is part of `NotePatch`)
- [x] 30-day trash with `Ctrl+Z` undo, multiple selection and bulk actions
- [x] Global tag management: rename, merge, drop across the library
- [x] `{{fields}}` in snippets, and a quick-paste palette on a global shortcut
- [x] Attachments (drop, paste, open, save), and import / export / share
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
