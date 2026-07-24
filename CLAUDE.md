# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DevBox — a desktop "Swiss Army knife" utility app for developers (notes-taking, hashing, encoding). Front-end is **Angular 20**, native engine is **Rust / Tauri v2**. This is an early-stage scaffold: most feature modules exist only as unimplemented skeletons.

The project is not currently a git repository — there is no commit history to consult.

Primary language for code comments, docstrings, and UI strings in this repo is **French**. Match that convention when editing existing files.

## Commands

Run all commands from the repo root (`package.json` there wraps both Angular and Tauri).

- `npm install` — install JS dependencies (also required before first Rust build, since Tauri's build script reads front-end config).
- `npm run tauri dev` — main dev loop: starts `ng serve` (hot-reload on `src/`) and launches the Tauri window, which auto-rebuilds/reloads on Rust changes (slower than the front-end hot-reload).
- `npm start` / `ng serve` — Angular dev server only (port **1420**, fixed in `angular.json`; Tauri's `devUrl` in `tauri.conf.json` depends on this port).
- `npm run build` — production Angular build, output to `dist/devbox/browser` (path referenced by `frontendDist` in `tauri.conf.json`).
- `npm run tauri build` — full production build; native executable/installer lands in `src-tauri/target/release`.
- Rust-only iteration: `cargo build` / `cargo check` from `src-tauri/` (faster than a full `tauri build` when just checking Rust compile errors).

No test runner, linter, or formatter is currently configured for either the Angular or Rust side (no `.spec.ts` files, no clippy/rustfmt CI hook, no `test` script in `package.json`).

## Architecture

### IPC boundary (Angular ↔ Rust)

The two halves communicate exclusively through Tauri's `invoke()` bridge:

- Angular calls `invoke<T>('command_name', { argName: value })` (see `src/app/app.component.ts` for the reference example calling `saluer`).
- Rust exposes commands as plain functions annotated `#[tauri::command]`.
- **Every** new command must be registered in the `tauri::generate_handler![...]` macro call in `src-tauri/src/lib.rs`, or Angular's `invoke()` call will fail at runtime with a "command not found" error even though the Rust code compiles.
- Argument names must match exactly between the TS call site (`{ nom: ... }`) and the Rust function signature (`fn saluer(nom: String)`) — Tauri matches by name, not position.

### Rust command modules (`src-tauri/src/commands/`)

Commands are grouped by functional domain, one file per domain, all re-exported through `commands/mod.rs`:

- `greetings.rs` — working demo command (`saluer`), the reference pattern for new commands.
- `notes.rs` — note-taking (unimplemented skeleton).
- `crypto.rs` — hashing/crypto, e.g. planned `hash_sha256`, `generate_uuid` (unimplemented skeleton).
- `formatters.rs` — encoding/formatting, e.g. planned `encode_base64`, `format_json` (unimplemented skeleton).

Convention for these modules (stated in their doc comments): keep business logic (disk I/O, DB access, hashing algorithms) in plain Rust functions separate from the `#[tauri::command]` wrapper, so logic can be unit-tested without spinning up Tauri. The skeleton functions currently in these files are placeholders (`#[allow(dead_code)]`, not registered in `lib.rs`) — replace rather than build on top of them when implementing a domain for real.

To add a new command: write the `pub fn` with `#[tauri::command]` in the relevant domain file (or a new one, declared in `commands/mod.rs`), then add it to `generate_handler![...]` in `lib.rs`.

### Tauri configuration

- `src-tauri/tauri.conf.json` wires the dev/build pipeline to Angular: `beforeDevCommand`/`beforeBuildCommand` run the npm scripts, `devUrl` must match the Angular dev server port (1420), `frontendDist` must match Angular's build output path.
- `src-tauri/capabilities/default.json` is the Tauri v2 permissions manifest for the main window — any new Tauri plugin or restricted API needs its permission added here or the call will be denied at runtime.
- CSP is currently disabled (`"csp": null`) — tighten this before shipping if the app starts loading remote content.

### Front-end

Angular app is a minimal standalone-component bootstrap (`src/main.ts` → `bootstrapApplication`), no NgModules. `src/app/app.routes.ts` is currently empty — routing is not yet in use. `AppComponent` is presently just the `saluer` IPC demo; it is expected to be replaced as real features (notes, crypto, formatters UI) are built.

### Design reference

`docs/scratch-mockup-v2.html` is a static, standalone HTML/CSS mockup (dark theme, JetBrains Mono + Inter) sketching the intended UI: a notes/snippets manager with a titlebar, a "spaces" switcher, tag filtering, pinned/untriaged sections, and a code-preview overlay. Treat it as a visual/UX reference for future Angular components, not as code to run or import.