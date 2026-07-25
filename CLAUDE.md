# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DevBox — a desktop "Swiss Army knife" utility app for developers (notes-taking, hashing, encoding). Front-end is **Angular 22** (standalone components, signals, zoneless change detection), native engine is **Rust / Tauri v2**.

The **notes feature is complete end to end**: front-end (spaces with creation and filtering, search, filters, tag rail, sections, full note editing — content, format, tags, pin, deletion), IPC (no mock data left, `Tauri*Repository` is the only data source, every read/write goes through `IpcService`), and Rust (`query_notes`, `create_note`, `update_note`, `delete_note`, `list_spaces`, `create_space` persist to an embedded SQLite database). `crypto` and `formatters` are still unregistered stubs.

**Data processing belongs to Rust.** Filtering (space, full-text, tags, quick filters), grouping into sections, tag aggregation and tag normalisation all run in `src-tauri/src/storage/`. `query_notes` returns a ready-to-render `NotesView`; the front-end describes the query and displays the answer, it never filters, sorts or groups. Deliberate exceptions: relative-time labels (must age without a round trip), the ISO ↔ `Date` conversion at the serialisation boundary, and pure UI concerns (shortcuts, editor drafts, which space a new note goes to).

Persistence lives in `src-tauri/src/storage/` — `rusqlite` with the `bundled` feature, database file in `app_data_dir()`. The commands in `src-tauri/src/commands/` are thin adapters over it. `docs/architecture.md` has the details (layering, concurrency, migrations, schema rationale).

Primary language for code comments, docstrings, and UI strings in this repo is **French**. Match that convention when editing existing files. Test descriptions and test comments are the deliberate exception: they're written in **English**.

`docs/architecture.md` is the detailed architecture reference (front-end structure, state and data-access patterns, i18n, theming, IPC boundary, testing conventions). Read it before making structural changes, and keep it in sync when you make them — it's the canonical place for that documentation, not this file and not the README.

## Commands

Run all commands from the repo root (`package.json` there wraps both Angular and Tauri).

- `npm install` — install JS dependencies (also required before the first Rust build, since Tauri's build script reads front-end config).
- `npm run tauri dev` — main dev loop: starts `ng serve` (hot-reload on `src/`) and launches the Tauri window, which auto-rebuilds/reloads on Rust changes (slower than the front-end hot-reload).
- `npm start` / `ng serve` — Angular dev server only (port **1420**, fixed in `angular.json`; Tauri's `devUrl` in `tauri.conf.json` depends on this port).
- `npm run build` — production Angular build, output to `dist/devbox/browser` (path referenced by `frontendDist` in `tauri.conf.json`).
- `npm run tauri build` — full production build; native executable/installer lands in `src-tauri/target/release`.
- Rust-only iteration: `cargo build` / `cargo check` from `src-tauri/` (faster than a full `tauri build` when just checking Rust compile errors).
- `npm test` — Angular unit tests via the `@angular/build:unit-test` builder with **Vitest** (jsdom, no browser required). `npm run test:watch` re-runs on change; `npm run test:coverage` adds a v8 coverage report with 80% thresholds.
- `npm run lint` — ESLint (with `angular-eslint`, including its template accessibility rules) plus a Prettier format check. `npm run lint:fix` fixes what it can; `npm run format` runs Prettier alone.

- `cargo test` from `src-tauri/` — persistence and serialisation tests (no extra setup; they run against an in-memory SQLite database).

The Rust side has no linter or formatter configured (no clippy or rustfmt hook).

## Things that will bite you

These are the non-obvious constraints; the rest of the architecture is in `docs/architecture.md`.

- **Registering commands.** A new `#[tauri::command]` must be added to `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`, or `invoke()` fails at runtime with "command not found" even though the Rust compiles. Argument names must match exactly between the TS call site (`{ nom: … }`) and the Rust signature (`fn saluer(nom: String)`) — Tauri matches by name, not position.
- **Serialisation contract.** JSON has no date type, so every `Date` crosses the bridge as an ISO string and is converted in `core/data/note.dto.ts` / `note-view.dto.ts` — never type an `invoke()` result as a domain model directly. On the Rust side the `Note`, `NotesQuery` and `NotesView` structs need `#[serde(rename_all = "camelCase")]` (`spaceId`, `createdAt`, `availableTags`…) and the lifecycle enum `#[serde(tag = "kind", rename_all = "camelCase")]`, or the front-end cannot read what it receives.
- **Errors are codes, not strings.** Commands return `Result<T, AppError>` (`commands/error.rs`): a stable `code`, its interpolation `params`, and a technical `detail`. The front maps the code to a translation key (`duplicateSpaceName` → `errors.spaceNameTaken`). Returning a `String` would put a French sentence in the English UI and force callers to parse prose. `IpcErrorCode` mirrors `ErrorCode` — add a variant to both. `IpcError.code` is `null` when Tauri itself rejects (unknown command, bad argument), so handle that.
- **Data-source seam.** Components and stores never touch a data source directly: everything goes through the `NOTES_REPOSITORY` / `SPACES_REPOSITORY` tokens, bound in `core/data/data.providers.ts`. Don't call `invoke()` from a component or a store — `IpcService` is the only caller. There is no in-memory dataset anymore; the only doubles live in `src/testing/`. `NotesRepository` has **no method returning a raw note list** — that's on purpose, one would invite re-filtering on the front.
- **`null` space means "all spaces".** `SpacesStore.activeSpaceId()` is `null` when the user wants every space, and that is a choice, not a loading state — don't add an "All" row to the spaces data, notes would end up filed into it. A note always has a `spaceId`; creating one with no space available is refused on purpose.
- **The editor keeps local drafts.** Title and body are `linkedSignal`s keyed on the note **id** (not the note object, whose identity changes on every save), committed on blur _and_ on every closing path — Escape, backdrop and close button produce no `blur`, so `requestClose()` commits first. Persisting on `(input)` would mean one IPC round-trip per keystroke.
- **Sections must stay exhaustive.** `storage::sections::build` classifies every unpinned note into exactly one of `today` / `week` / `older` (an unparseable date lands in `older`). A note in no section is unreachable in the UI, search included. `week` is always emitted — it hosts the create-ghost card. An active search or tag selection switches to a single flat `results` section; a quick filter does **not**.
- **Section boundaries are local days.** The query carries `tzOffsetMinutes` next to `now`, or a note created at 23:00 lands on the wrong day. Mind the sign: JS `getTimezoneOffset()` returns −120 for UTC+2, the opposite of chrono's `FixedOffset` — hence the `-` in `offset_from_minutes`.
- **The search is debounced (150 ms).** Filtering crosses the IPC bridge, so `setSearchQuery` updates the field immediately but defers the query. In specs, fake only `['setTimeout', 'clearTimeout']`.
- **Read-only store signals.** Writable signals in a store are private (`_x`) and exposed via `.asReadonly()`; mutation goes through methods. Writes are **not** optimistic: persist, adopt the returned note, reload the view — nothing is applied locally, so there is nothing to roll back. `resource.value()` throws while in error — read it behind a `hasValue()` guard.
- **`NotesStore.view` is a `linkedSignal` that only retains what it is read through.** It keeps the previous view during a reload so the canvas doesn't blank on every keystroke. Everything the store exposes reads it, and `isLoading` reads it _first_ — a `&&` that short-circuits past it would drop the freshly loaded view on the floor.
- **Translation keys, not strings.** Code that produces user-visible text returns a translation reference (`{ key, params }`) consumed by the `transloco` pipe in the template. Adding a string means adding it to **both** `src/app/core/i18n/translations/fr.json` and `en.json`. No user-visible string belongs in the domain layer — a new note gets an empty title, and the UI renders a translated placeholder.
- **Accessibility is enforced by the linter.** Decorative emoji need `aria-hidden`, toggles need `aria-pressed`, and information shown only graphically needs a `.visually-hidden` text twin. `npm run lint` catches most of it.
- **CSS variables must stay global.** Theme variables live on `:root` in `src/styles.scss`. Angular's emulated encapsulation rewrites a `:root` selector inside a `*.component.scss` into a form that never matches `<html>`, silently invalidating every variable. Shared SCSS patterns are mixins in `src/styles/_mixins.scss`, imported as `@use 'mixins' as *;`.
- **Fake timers in tests.** Use `vi.useFakeTimers({ toFake: ['Date'] })` for date-dependent components. Plain `vi.useFakeTimers()` also fakes `requestAnimationFrame`, which Angular's zoneless scheduler needs, and `await fixture.whenStable()` then hangs forever.
- **Time comes from `ClockService`.** Pure time utils take `now: Date` as a parameter and callers pass `clock.now()`. Reading `new Date()` inside a `computed()` freezes the value: the computed depends on no signal representing time, so a card shows "4 min ago" forever.
- **CSP is on.** `src-tauri/tauri.conf.json` locks the WebView down; `ipc:` and `http://ipc.localhost` must stay in `connect-src` or `invoke()` is blocked. Anything remote (fonts, images, APIs) needs a deliberate widening — fonts are self-hosted via `@fontsource` for exactly this reason.
- **Rust: notes/spaces vs. crypto/formatters.** `notes.rs` and `spaces.rs` are a _contract_ — don't change the shape of their structs without changing the DTOs on the front; the serde tests in `notes.rs` will fail if you do. `crypto.rs` and `formatters.rs` are still `#[allow(dead_code)]` stubs unregistered in `lib.rs` — replace those rather than building on top of them.
- **Search matching is Rust, not SQL.** SQLite's `LOWER()` only folds ASCII without ICU, so a `WHERE LOWER(title) LIKE …` would stop matching `Étape` against `étape`. Coarse filters (space, pin, lifecycle, tags) stay in SQL where they're indexed; text matching runs on the fetched rows via `to_lowercase()`.
- **Tag normalisation lives in `replace_tags`, and only there.** Trim, strip leading `#`, drop blanks, collapse case-insensitive duplicates. The front sends the raw string. The returned tags are sorted to match what a read gives back, or a note's tags reorder themselves on the next reload.
- **Migrations are append-only.** The SQLite schema is versioned by `PRAGMA user_version` in `src-tauri/src/storage/mod.rs`. Changing the model means a new `MIGRATION_N` and a new branch in `migrate` — never editing `MIGRATION_1`, which has already run on existing installs. Deleting the database file is a legitimate reset during development (`app_data_dir()/devbox.sqlite3`).
- **`PRAGMA foreign_keys` is per connection, not per database.** It's set in `storage::configure`; without it the `ON DELETE CASCADE` clauses in the schema are inert and deleting a note leaves its tags behind.
- **Zoneless.** Every component is `OnPush` and state is signal-based; derived state is `computed()`, never a manually maintained signal.

## Design reference

`docs/scratch-mockup-v2.html` is a static, standalone HTML/CSS mockup (dark theme, JetBrains Mono + Inter) sketching the intended UI. Treat it as a visual/UX reference for components, not as code to run or import.
