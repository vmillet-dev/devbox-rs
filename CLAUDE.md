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
- `npm test` — runs the Angular unit test suite via the `@angular/build:unit-test` builder with **Vitest** as the runner (jsdom environment, no browser required). `npm run test:watch` re-runs on change; `npm run test:coverage` adds a v8 coverage report.

No linter or formatter is currently configured for either the Angular or Rust side (no clippy/rustfmt CI hook). The Rust side still has no test runner configured.

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

### Testing

Unit tests live next to the file they cover (`*.component.spec.ts`, `*.util.spec.ts`, ...) and run under Vitest via `@angular/build:unit-test` (configured in `angular.json`'s `test` target and `vitest-base.config.ts`). Test descriptions and comments are written in **English** (the one place in this repo that deliberately departs from the French-first convention above), to match Vitest/Angular community conventions.

Shared test helpers live in `src/testing/` (not matched by the default `**/*.spec.ts` include, so they're never picked up as tests themselves):
- `note.fixture.ts` — `createNote(overrides)` builds a fully-populated `Note` for tests.
- `fake-notes-repository.ts` — `FakeNotesRepository` is an in-memory `NotesRepository` test double for `NotesStore`/component tests that need controlled data instead of the real mock dataset.

Component tests are isolated at the component level using a consistent pattern, rather than mocking Angular's DI or stubbing out child components:
- Render the component under test with `TestBed` using its **real** child components (they're standalone and declared in the component's own `imports`, so no extra wiring is needed).
- Assert against a child's public contract only — read its input signals (e.g. `child.language()`) and call/subscribe to its output emitters directly (e.g. `child.opened.emit(id)`, `component.opened.subscribe(...)`) — instead of relying on the child's rendered DOM. This keeps the test isolated to the component's own template-wiring and class logic; the child's own behavior is covered by its own spec file.
- `TestBed.createComponent(...)` + fixture assignment happens in a `beforeEach`, not a per-test helper function, so every spec shares one setup path. Default/required inputs are set there too.
- Change detection follows Angular's own guidance for zoneless tests: call `fixture.autoDetectChanges()` once in `beforeEach` (it also performs the initial render) instead of manually calling `fixture.detectChanges()`. After a test triggers a state change (`setInput`, an emitted child output, a dispatched DOM event), `await fixture.whenStable()` before asserting on the DOM — this lets Angular's own scheduler decide when to re-render, the same as it would in production, rather than forcing a synchronous check.
- For components with date-dependent formatting (relative time, expiry), use `vi.useFakeTimers({ toFake: ['Date'] })` / `vi.setSystemTime(...)` for determinism. **Don't** call `vi.useFakeTimers()` with no `toFake` list here — it also fakes `requestAnimationFrame`, which Angular's zoneless scheduler uses internally, so `await fixture.whenStable()` will hang forever waiting for a frame that fake timers never deliver.
- `NotesPageComponent` (and anything that transitively needs `NotesStore`) provides `NOTES_REPOSITORY` with `FakeNotesRepository` and spies on the real `NotesStore`'s methods (`vi.spyOn(store, '...')`) rather than re-implementing a fake store — `NotesStore` itself is unit-tested separately in `notes.store.spec.ts`.

### Design reference

`docs/scratch-mockup-v2.html` is a static, standalone HTML/CSS mockup (dark theme, JetBrains Mono + Inter) sketching the intended UI: a notes/snippets manager with a titlebar, a "spaces" switcher, tag filtering, pinned/untriaged sections, and a code-preview overlay. Treat it as a visual/UX reference for future Angular components, not as code to run or import.