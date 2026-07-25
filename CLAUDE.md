# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DevBox — a desktop "Swiss Army knife" utility app for developers (notes-taking, hashing, encoding). Front-end is **Angular 22** (standalone components, signals, zoneless change detection), native engine is **Rust / Tauri v2**.

The two halves are at very different stages: the **notes feature is fully built on the front-end** (spaces, search, filters, tag rail, sections, editor overlay) but runs on in-memory mock data, while the **Rust side is still the scaffold** — one demo command (`saluer`) plus documented skeletons for notes/crypto/formatters. The front-end makes no `invoke()` call yet.

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
- `npm test` — Angular unit tests via the `@angular/build:unit-test` builder with **Vitest** (jsdom, no browser required). `npm run test:watch` re-runs on change; `npm run test:coverage` adds a v8 coverage report.

No linter or formatter is configured for either side (no ESLint, Prettier, clippy or rustfmt hook). The Rust side has no tests or test runner.

## Things that will bite you

These are the non-obvious constraints; the rest of the architecture is in `docs/architecture.md`.

- **Registering commands.** A new `#[tauri::command]` must be added to `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`, or `invoke()` fails at runtime with "command not found" even though the Rust compiles. Argument names must match exactly between the TS call site (`{ nom: … }`) and the Rust signature (`fn saluer(nom: String)`) — Tauri matches by name, not position.
- **Data-source seam.** Components and the store never touch a data source directly: everything goes through the `NOTES_REPOSITORY` token, bound in `app.config.ts`. Don't import mock datasets into components or call `invoke()` from them.
- **Translation keys, not strings.** Code that produces user-visible text returns a translation reference (`{ key, params }`) consumed by the `transloco` pipe in the template. Adding a string means adding it to **both** `src/assets/i18n/fr.json` and `en.json`.
- **CSS variables must stay global.** Theme variables live on `:root` in `src/styles.scss`. Angular's emulated encapsulation rewrites a `:root` selector inside a `*.component.scss` into a form that never matches `<html>`, silently invalidating every variable. Shared SCSS patterns are mixins in `src/styles/_mixins.scss`, imported as `@use 'mixins' as *;`.
- **Fake timers in tests.** Use `vi.useFakeTimers({ toFake: ['Date'] })` for date-dependent components. Plain `vi.useFakeTimers()` also fakes `requestAnimationFrame`, which Angular's zoneless scheduler needs, and `await fixture.whenStable()` then hangs forever.
- **Rust skeletons are placeholders.** The functions in `notes.rs`, `crypto.rs` and `formatters.rs` are `#[allow(dead_code)]` stubs, unregistered in `lib.rs` — replace them rather than building on top of them.
- **Zoneless.** Every component is `OnPush` and state is signal-based; derived state is `computed()`, never a manually maintained signal.

## Design reference

`docs/scratch-mockup-v2.html` is a static, standalone HTML/CSS mockup (dark theme, JetBrains Mono + Inter) sketching the intended UI. Treat it as a visual/UX reference for components, not as code to run or import.