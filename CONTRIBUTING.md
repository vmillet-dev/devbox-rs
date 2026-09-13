# Contributing to DevBox

Thanks for taking the time. This file covers what the compiler and CI cannot tell you: the
handful of conventions that are load-bearing, and where the traps are.

DevBox is licensed under the [GNU GPL v3.0](LICENSE). Opening a pull request means you agree
to have your contribution distributed under those terms.

## Getting set up

You need Node.js 20+, Rust via `rustup`, and
[Tauri's system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev
```

`npm install` is required before the first Rust build too — Tauri's build script reads the
front-end config. The toolchain is pinned in `rust-toolchain.toml`, so a new stable release
cannot turn CI red on a commit nobody touched.

## What CI checks

Run these before pushing; they are exactly what the pipeline runs.

```bash
npm run lint && npm test && npm run test:scripts
```

```bash
cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
```

`--all-features` is not optional: it is what compiles the `e2e` feature, which nothing else
type-checks.

The end-to-end suite drives a **built** binary, so it needs a rebuild after any change to
`src/` or `src-tauri/`:

```bash
npm run e2e:build && npm run test:e2e
```

That binary carries an identifier of its own, so running the suite never touches the library
you use day to day.

## Things that are not guesswork

**Migrations are append-only.** A model change means a new `src-tauri/migrations/`
directory, never an edit to one that already shipped — it has already run on installed
databases. `src-tauri/src/db/schema.rs` is **hand-written**, not generated, so a new column
means editing both it and the SQL. Deleting `app_data_dir()/devbox.sqlite3` is a legitimate
reset while developing.

**The IPC surface is generated.** `src/app/core/ipc/bindings.ts` comes from the Rust
signatures. A new command needs `#[tauri::command]`, `#[specta::specta]`, and an entry in
`collect_commands![…]` in `src-tauri/src/lib.rs` — that single list both registers with Tauri
and drives the generation. Then `npm run bindings`. Commit the result.

**Commands that touch the database or the disk are `#[tauri::command(async)]`.** A plain
`#[tauri::command]` runs its body inline on the WebView's IPC thread and freezes the window
for as long as it takes. The tray and global-shortcut commands in `desktop.rs` are the
deliberate exception — they want the main thread.

**Errors are codes, not strings.** Commands return `Result<T, AppError>` carrying a stable
`code`, its interpolation `params` and a technical `detail`. A French sentence must never
reach an English UI. Adding an `ErrorCode` variant breaks the front-end build until
`CODE_KEYS`, `IPC_ERROR_CODES` and **both** locale files have their key — that is the
intended behaviour, not an obstacle.

**No user-facing text lives in Rust.** The front end holds the translations; a new note gets
an empty title and the UI renders a translated placeholder. The one exception is
`CHANGELOG.md`, which is data shipped as a file.

**Business rules live in `<feature>/model.rs`**, which imports neither Diesel nor Tauri, so
its tests run without a database. `<feature>/store.rs` is SQL and nothing else.
`<feature>.rs` holds the commands: validate, lock, delegate, translate the error — a command
that grows means a rule landed in the wrong place.

## Style

Code, comments, docstrings and test names are in **English**. UI strings are translation
keys, resolved from `fr.json` and `en.json` — add to both.

**Comments record decisions, not narration.** Keep one only when it says something the code
cannot: a load-bearing ordering, a platform trap, a non-obvious invariant, or why the obvious
approach was rejected. Anything restating a signature or narrating the next line belongs in
neither.

Rust unit tests are inline `#[cfg(test)] mod tests` blocks at the bottom of the file they
cover; `src-tauri/tests/` holds the integration binaries, which see only the crate's public
API. Test names are sentences — `a_blank_name_is_refused_with_its_field`, not `test_name_2`.

## Pull requests

Branch off `main`, keep one subject per pull request, and make sure the checks above pass.

**Label your issues.** Release notes are generated from merged pull requests, and a pull
request inherits the labels of the issue it closes (`Closes #42`) — GitHub propagates
nothing on its own. See the "Releasing" section of the [README](README.md#releasing) for how
an entry gets filed. Nothing is ever dropped for want of a label.

Found something broken or surprising? Open an issue with what you did, what you expected and
what happened. A version number and an OS help more than they look like they would.
