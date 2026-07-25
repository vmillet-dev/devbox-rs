# Architecture

How DevBox is put together, and the conventions to follow when extending it.
For build/run instructions see the [README](../README.md).

## Overview

DevBox is a Tauri v2 desktop app: an Angular single-page front-end rendered in a WebView,
and a Rust process that will own everything native (storage, hashing, filesystem). The two
halves talk only through Tauri's `invoke()` bridge.

Today that bridge is unused: the front-end reads its data from an in-memory mock
repository, and the Rust side exposes a single demo command. The seam is deliberately
placed so plugging in the real backend touches one provider, not the whole app.

```
src/                Angular front-end
├── app/
│   ├── core/       state, data access, models, i18n, pure utils
│   ├── features/   feature screens (notes)
│   ├── layout/     app shell, titlebar
│   └── shared/ui/  reusable presentational components
├── assets/i18n/    translation files
├── styles.scss     global theme
└── testing/        test doubles and helpers
src-tauri/          Rust back-end
├── src/commands/   one file per functional domain
├── src/lib.rs      Tauri builder + command registration
└── capabilities/   Tauri v2 permission manifests
```

## Front-end

The app bootstraps standalone components (`src/main.ts` → `bootstrapApplication`); there
are no NgModules. Routing exists as a provider but `app.routes.ts` is empty — the app is
single-screen for now.

Change detection is **zoneless** (`provideZonelessChangeDetection()`). State lives in
signals and every component is `OnPush`.

### Component contracts

Components communicate exclusively through signal inputs (`input()` / `input.required()`)
and `output()` emitters. Only the feature container (`NotesPageComponent`) injects the
store; everything below it is presentational and stateless, which is what makes the
components testable in isolation.

Presentational components that could serve any feature live in `shared/ui/`; those
specific to notes live under the feature's own `components/` folder.

### State

`NotesStore` (`providedIn: 'root'`) holds the notes plus the UI query state — search text,
active filter, selected tags, selected note — as signals, and derives the rest as
`computed()`: filtered notes → display sections → selected note.

Rules of the house:

- All mutations go through store methods, which replace notes immutably rather than
  editing them in place.
- Derived state is `computed()`, never a manually maintained signal.
- Grouping/formatting logic that doesn't need injection lives in `core/utils/` as pure
  functions taking `now: Date = new Date()` as a parameter, so tests can pin time.

### Data access

The store never talks to a data source directly. It injects the `NOTES_REPOSITORY` token —
an interface with a single `loadAll(): Promise<Note[]>` — and `app.config.ts` binds that
token to the in-memory mock implementation.

When the Rust backend lands, an implementation calling `invoke<Note[]>('list_notes')`
replaces the mock in that one provider; the store and every component stay unchanged. Keep
this seam intact: no component should ever import a mock dataset or call `invoke()`
directly.

### i18n

UI strings live in `src/assets/i18n/{fr,en}.json` and are rendered through Transloco's
`transloco` pipe. French is the default locale.

- Translations are `import`ed and bundled at build time rather than fetched over HTTP —
  this is a small desktop binary with two locales, so `HttpClient` and a network round-trip
  would buy nothing.
- `LocaleService` wraps `TranslocoService` and persists the choice in `localStorage`
  (`devbox.locale`). It's instantiated from an app initializer so the stored locale applies
  before the first render, avoiding a flash of the default language.
- Code that produces user-visible text returns a **translation reference**
  (`{ key, params }`) instead of a formatted string, so the actual translation always
  happens in the template. Model fields holding such keys are documented as keys, not
  labels.

### Theming

All colors, fonts and shadows are CSS custom properties defined on `:root` in the global
`src/styles.scss`; components only consume them via `var(--…)`.

Those variables **must** stay in the global stylesheet. Angular's emulated encapsulation
rewrites a `:root` selector written inside a `*.component.scss` into a form that never
matches `<html>`, silently invalidating every variable.

Recurring style patterns (unstyled control, card surface, accent state, tinted badge) are
SCSS mixins in `src/styles/_mixins.scss`, imported as `@use 'mixins' as *;` — resolved via
`stylePreprocessorOptions.includePaths` in `angular.json`.

Colors that need translucency are also exposed as RGB triplets (e.g. `--amber-rgb`) so
`rgba()` usages never hard-code a hex value.

## IPC boundary (Angular ↔ Rust)

- Angular calls `invoke<T>('command_name', { argName: value })`.
- Rust exposes commands as plain functions annotated `#[tauri::command]`.
- **Every** command must be registered in `tauri::generate_handler![...]` in
  `src-tauri/src/lib.rs`, or the call fails at runtime with "command not found" even though
  the Rust compiles fine.
- Argument names must match exactly between the TS call site (`{ nom: … }`) and the Rust
  signature (`fn saluer(nom: String)`) — Tauri matches by name, not position.

`saluer` in `commands/greetings.rs` is the working reference example.

## Rust command modules

Commands are grouped one file per functional domain under `src-tauri/src/commands/`,
re-exported through `mod.rs`: `greetings` (demo), `notes`, `crypto`, `formatters`.

Keep business logic — disk I/O, DB access, hashing algorithms — in plain Rust functions,
with the `#[tauri::command]` function as a thin adapter over them. That keeps the logic
unit-testable without spinning up Tauri.

The functions currently in `notes.rs`, `crypto.rs` and `formatters.rs` are placeholders
(`#[allow(dead_code)]`, not registered in `lib.rs`) — replace them rather than building on
top of them.

**To add a command:** write the `pub fn` with `#[tauri::command]` in the relevant domain
file (or a new one declared in `commands/mod.rs`), add it to `generate_handler![...]` in
`lib.rs`, then call it from Angular with `invoke('command_name', { …args })`.

## Tauri configuration

- `src-tauri/tauri.conf.json` wires the pipeline to Angular: `beforeDevCommand` /
  `beforeBuildCommand` run the npm scripts, `devUrl` must match the Angular dev server port
  (1420, fixed in `angular.json`), and `frontendDist` must match Angular's build output
  path.
- `src-tauri/capabilities/default.json` is the v2 permission manifest for the main window.
  Any new plugin or restricted API needs its permission listed there, or the call is denied
  at runtime.
- CSP is currently disabled (`"csp": null`). Tighten it before shipping if the app ever
  loads remote content.

## Testing

Unit tests run with Vitest through the `@angular/build:unit-test` builder in a jsdom
environment (configured in `angular.json`'s `test` target and `vitest-base.config.ts`), so
no browser is needed. Specs sit next to the file they cover.

Shared helpers live in `src/testing/`, which is outside the `**/*.spec.ts` include and so
never collected as tests: a `Note` fixture builder, an in-memory repository double, and the
app's Transloco providers for components whose templates use the `transloco` pipe.

Component specs follow one consistent pattern:

- Render the component with its **real** children — they're standalone and already declared
  in the component's own `imports`, so no extra wiring is needed. Don't stub children or
  mock Angular's DI.
- Assert against a child's public contract only: read its input signals, and call or
  subscribe to its output emitters. Don't reach into a child's rendered DOM — that child's
  behavior is covered by its own spec.
- Do `TestBed.createComponent(...)` and set required inputs in `beforeEach`, not in a
  per-test helper, so every spec shares one setup path.
- Call `fixture.autoDetectChanges()` once in `beforeEach` (it also performs the initial
  render), then `await fixture.whenStable()` after any state change before asserting on the
  DOM. This lets Angular's own scheduler decide when to re-render, as it would in
  production, instead of forcing synchronous checks.
- For date-dependent output (relative time, expiry), use
  `vi.useFakeTimers({ toFake: ['Date'] })` with `vi.setSystemTime(...)`. **Never** call
  `vi.useFakeTimers()` without a `toFake` list here: it also fakes `requestAnimationFrame`,
  which the zoneless scheduler relies on, and `await fixture.whenStable()` will hang
  forever.
- For anything that transitively needs `NotesStore`, provide `NOTES_REPOSITORY` with the
  fake repository and spy on the real store's methods rather than re-implementing a fake
  store — the store has its own spec.

The Rust side has no tests or test runner configured yet.