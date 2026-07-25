# Architecture

How DevBox is put together, and the conventions to follow when extending it.
For build/run instructions see the [README](../README.md).

## Overview

DevBox is a Tauri v2 desktop app: an Angular single-page front-end rendered in a WebView,
and a Rust process that owns everything native (storage, and later hashing and filesystem).
The two halves talk only through Tauri's `invoke()` bridge.

Notes and spaces are complete end to end: the front-end has no in-memory dataset left, every
read and write goes through `invoke()`, and the Rust commands persist to an embedded SQLite
database. The remaining domains (`crypto`, `formatters`) are still unregistered stubs.

```
src/                Angular front-end
├── app/
│   ├── core/       state, data access, models, IPC, i18n, time, errors, pure utils
│   ├── features/   feature screens (notes)
│   ├── layout/     app shell, titlebar
│   └── shared/     reusable presentational components and a11y directives
├── assets/         static images
├── styles.scss     global theme
└── testing/        test doubles, fixtures and shared providers
src-tauri/          Rust back-end
├── src/commands/   one file per functional domain — thin adapters over storage
├── src/storage/    SQLite persistence: schema, migrations, notes and spaces access
├── src/lib.rs      Tauri builder, database setup + command registration
└── capabilities/   Tauri v2 permission manifests
```

Imports use path aliases rather than deep relative paths: `@core/*`, `@shared/*`,
`@features/*`, `@layout/*`, `@testing/*` (declared in `tsconfig.json`).

## Front-end

The app bootstraps standalone components (`src/main.ts` → `bootstrapApplication`); there
are no NgModules. Change detection is **zoneless** (`provideZonelessChangeDetection()`).
State lives in signals and every component is `OnPush` — enforced by the
`prefer-on-push-component-change-detection` lint rule, not by convention alone.

### Routing

`AppComponent` renders `AppShellComponent`, which holds the persistent chrome (titlebar,
global error banner) and a `<router-outlet>`. Features are lazy-loaded with
`loadComponent`, so adding the planned crypto and formatters tools will not weigh on the
initial bundle.

Routing uses **hash location** (`withHashLocation()`). Tauri serves the built files from an
internal protocol with no server to rewrite deep URLs back to `index.html`; the fragment
sidesteps the problem entirely.

### Component contracts

Components communicate exclusively through signal inputs (`input()` / `input.required()`),
`model()` where a value is genuinely two-way (the search field), and `output()` emitters.
Only the feature container (`NotesPageComponent`) injects stores; everything below it is
presentational and stateless, which is what makes the components testable in isolation.

Presentational components that could serve any feature live in `shared/ui/` — including
`CodeViewerComponent`, which knows nothing about notes and will be reused by the formatters
feature. Components specific to notes live under the feature's own `components/` folder.

Components never reach into each other imperatively. A keyboard shortcut belongs to the
component that owns the affected element: `Ctrl/⌘+K` is handled inside `SearchBoxComponent`,
which also renders the hint, rather than travelling down a chain of `viewChild` calls.

### State

`NotesStore` (`providedIn: 'root'`) holds the notes plus the UI query state — search text,
active filter, selected tags, selected note — and derives the rest as `computed()`:
notes of the active space → filtered notes → display sections → selected note.

`SpacesStore` owns the spaces and the active one. Two decisions matter there:

- **The active space is a filter, not a label.** `NotesStore` injects `SpacesStore` (never the
  other way round) and reads `activeSpaceId()` at the head of its derivation chain, so the
  space also scopes the tag rail — a tag that filters nothing in the current space has no
  reason to be offered.
- **`null` means "all spaces", and is a choice, not a loading state.** There is deliberately
  no "All" row in the data: it would be a phantom space that notes could be filed into by
  mistake. The label lives in the translations, and an active id matching no known space
  degrades back to `null` rather than hiding every note.

Creating a note files it in the active space, falling back to the first one in "all spaces"
mode; with no space at all, creation is refused with a translated message, because a note
with no `spaceId` would vanish as soon as a space filter is applied.

Rules of the house:

- **Writable signals stay private, exposed read-only.** A store field is
  `private readonly _x = signal(...)` plus `readonly x = this._x.asReadonly()`. Every
  mutation therefore goes through a method, which stays the single entry point the day a
  write becomes more than a `set()`.
- **Loading is a `resource()`.** It provides `isLoading`, `error` and `reload()` for free,
  and its value is writable, so local mutations apply to it without duplicating the list in
  a second signal. Note that `resource.value()` **throws** while the resource is in error;
  read it through a `hasValue()` guard.
- **Writes are optimistic.** The UI updates immediately, then persistence either confirms
  (the returned note is adopted, it is authoritative) or fails — in which case only the
  affected note is rolled back and an `ErrorNotifier` message is raised. Rolling the whole
  list back would clobber concurrent edits.
- **Ids and timestamps come from persistence**, never from the front-end.
- Derived state is `computed()`, never a manually maintained signal.
- Grouping and formatting logic that needs no injection lives in `core/utils/` as pure
  functions taking `now: Date` as a parameter.

### Display sections

`groupNotesIntoSections` classifies notes into `pinned`, `today`, `week` and `older`. The
classification is **exhaustive**: apart from pinned notes, each note falls into exactly one
section. This is a guarantee, not an implementation detail — a note belonging to no section
is unreachable in the UI, search included.

As soon as a search query or a tag filter is active, the view switches to a single flat
`results` section (`toSearchResultsSection`). Spreading search results across date sections
dilutes them and hides matches at the bottom of the page.

A section's key **is** its translation key (`'sections.' + key`), so no label is kept in
sync by hand.

### Editing a note

The editor overlay is where every note mutation starts (title, body, language, tags, pin,
deletion). It stays presentational — it emits, the store persists — but it holds **local
drafts** for the title and the body, because persisting on every keystroke means one IPC
round-trip per character. Drafts are confirmed on blur, and, crucially, on every closing path:
Escape, the backdrop and the close button all skip `blur`, so closing goes through a single
`requestClose()` that commits first.

Those drafts are `linkedSignal`s keyed on the note **id**, not on the note object: every save
refreshes `updatedAt` and produces a new object, which would otherwise wipe the in-flight
edit.

The body toggles between the read-only `CodeViewerComponent` and a textarea. The preview is a
`<button>`, so entering edit mode works with the mouse and the keyboard without a hand-written
focus dance. Deletion is a two-step confirm in the toolbar rather than a native `confirm()`,
which would freeze the whole WebView.

### Data access

Stores never talk to a data source directly. They inject `NOTES_REPOSITORY` /
`SPACES_REPOSITORY`, and `core/data/data.providers.ts` binds those tokens — **the single
place where the application's data source is chosen**. Both are bound to the `Tauri*`
repositories; the only remaining doubles are the test ones in `src/testing/`, injected by
`provideAppTesting()`.

The notes contract is complete (`loadAll` / `create` / `update` / `delete`); spaces expose
`loadAll` / `create`. Renaming and deleting a space are not implemented on either side: the
open question is what happens to the notes of a deleted space (cascade, or move to a default
space). Moving a note is already expressible — `spaceId` is part of `NotePatch`.

Keep this seam intact: no component calls `invoke()`, and `IpcService` is its only caller.

## IPC boundary (Angular ↔ Rust)

All calls go through `IpcService` (`core/ipc/`), which types command names as a literal
union — a typo would otherwise only surface at runtime as "command not found" — and wraps
every failure in `IpcError`, carrying the failing command and the raw Rust `Err` value.

### Serialisation contract

`core/data/note.dto.ts` defines what actually travels over the bridge and converts it to the
domain model. Two traps it exists to handle:

- **JSON has no date type.** Every `Date` becomes an ISO 8601 string on the wire. The mapper
  parses it back and throws a `NoteContractError` on an unparseable value, rather than
  letting an `Invalid Date` propagate and resurface as `NaN` in a relative-time label.
- **Serde's defaults do not match the TypeScript shape.** The Rust `Note` struct needs
  `#[serde(rename_all = "camelCase")]` (otherwise the front receives `space_id` /
  `created_at` where it expects `spaceId` / `createdAt`), and the
  lifecycle enum needs `#[serde(tag = "kind", rename_all = "camelCase")]` (otherwise serde
  emits `{"Expires":{…}}`, which the discriminated union does not recognise).

An unknown `language` value degrades to `txt` instead of failing the load: a newer backend
may know a language this front-end build does not.

Patches are serialised field by field, omitting absent keys — an explicit `undefined` would
serialise to `null` and overwrite the stored value instead of leaving it untouched.

### Rules

- Argument names must match exactly between the TS call site (`{ nom: … }`) and the Rust
  signature (`fn saluer(nom: String)`) — Tauri matches by name, not position.
- **Every** command must be registered in `tauri::generate_handler![...]` in
  `src-tauri/src/lib.rs`, or the call fails at runtime even though the Rust compiles fine.

The commands the front-end calls — `list_notes`, `create_note`, `update_note`, `delete_note`,
`list_spaces`, `create_space` — live in `src-tauri/src/commands/notes.rs` and `spaces.rs`.
They are **adapters only**: lock the shared connection, delegate to `storage::`, map the error
to a `String`. The guarantees the front-end relies on (persisted value returned, `Err` on an
unknown id, "absent field means unchanged" for patches) are implemented and tested in
`src-tauri/src/storage/`.

The serialisation contract is pinned by tests in `commands/notes.rs` rather than left to
review: they assert the emitted JSON keys are camelCase and that a lifecycle serialises to
`{"kind":"expires","at":…}`. A serde attribute deleted by accident fails `cargo test` instead
of silently breaking the UI.

## Persistence (Rust)

Storage is **SQLite**, embedded through `rusqlite` with the `bundled` feature — SQLite is
compiled from source and statically linked, so nothing has to be installed or shipped
alongside the executable. The database file lives in Tauri's `app_data_dir()`.

- **Layering.** `storage::notes` and `storage::spaces` are plain functions taking a
  `&Connection`; the `#[tauri::command]`s sit on top. That is what makes persistence testable
  against `Connection::open_in_memory()` without launching Tauri.
- **Concurrency.** A rusqlite `Connection` is not `Sync`. A single connection is shared as
  `tauri::State<Db>` (`Db = Mutex<Connection>`), registered with `.manage()` in `lib.rs` —
  never a global. Overlapping commands serialise on that mutex.
- **Migrations.** The schema is versioned by `PRAGMA user_version`. Evolving the model means
  adding a `MIGRATION_N` constant and a branch in `migrate` — never editing a shipped
  migration, it has already run on user machines. Each migration is atomic. A database written
  by a newer build is refused rather than misread.
- **Schema choices that keep filtering movable to the back-end.** `lifecycle` is split into
  `lifecycle_kind` + `lifecycle_expires_at` columns rather than stored as JSON, and tags live
  in their own `note_tags` table rather than in a serialised column. Both exist so that
  filtering by tag, or querying what expires before a date, becomes a `WHERE` clause instead
  of a full re-read. `PRAGMA foreign_keys` is set per connection, which is what makes the
  `ON DELETE CASCADE` on notes and tags actually fire.
- **Ordering is the back-end's call.** `list_notes` returns everything ordered by
  `updated_at DESC`; the front-end preserves the order it receives when grouping into
  sections, so this query decides what the user sees first.
- **Timestamps are injected, not read.** `storage::notes` takes `now` as a parameter and the
  command passes `storage::now_iso()` — the same reason `ClockService` exists on the front.
  Millisecond precision is deliberate: two notes saved within one second would otherwise be
  impossible to order.

## Cross-cutting services

- **`ClockService`** (`core/time/`) exposes `now` as a signal ticking every 30 s. Relative
  time computed with `new Date()` inside a `computed()` freezes: the computed depends on no
  signal representing time, so it never re-evaluates and a card shows "4 min ago" forever.
  Injecting `now()` makes those computeds both pure and self-refreshing.
- **`PreferencesService`** (`core/preferences/`) wraps `localStorage`, which throws in
  private-browsing WebViews. A preference that cannot be saved must never take the app down.
- **`ErrorNotifier` + `AppErrorHandler`** (`core/errors/`) surface failures on screen through
  `ErrorBannerComponent`. On a desktop app the console is not an interface: an uncaught
  exception or a failed write has to be visible, or the app just looks unresponsive.

## i18n

UI strings live in `src/app/core/i18n/translations/{fr,en}.json` and render through
Transloco's `transloco` pipe. French is the default locale.

- Translations are `import`ed and bundled at build time rather than fetched over HTTP — a
  small desktop binary with two locales gains nothing from `HttpClient` and a round-trip.
  They deliberately sit **outside** `src/assets`, where the assets glob would copy them into
  `dist` a second time, never to be read.
- `LocaleService` wraps `TranslocoService`, persists the choice through `PreferencesService`
  and keeps `<html lang>` in sync (it drives screen-reader pronunciation and typography).
  `restore()` runs from an app initializer so the stored locale applies before the first
  render, avoiding a flash of the default language.
- Code that produces user-visible text returns a **`TranslationRef`** (`{ key, params }`)
  instead of a formatted string, so translation always happens in the template. This applies
  to error messages too.
- A new string means adding it to **both** locale files.
- Nothing user-visible is hard-coded in the domain layer. A new note is created with an
  empty title and source, and the UI renders translated placeholders — storing
  "Nouvelle note" would freeze French into the data.

## Accessibility

Treated as part of the definition of done, and partly enforced by
`angular.configs.templateAccessibility` in the ESLint config.

- **Decorative pictograms carry `aria-hidden="true"`.** The app uses emoji as icons; unmuted,
  each one is announced ("pushpin", "hourglass").
- **Information conveyed only graphically is duplicated as text.** A pinned card renders a
  `.visually-hidden` label, because the pin itself is a CSS pseudo-element.
- **Toggles expose `aria-pressed`**, not just a CSS class: tag pills, filter chips, the pin
  button, the locale switcher. A non-interactive tag pill renders a `<span>`, not a button —
  announcing a button would advertise an action that does not exist.
- **The editor overlay is a real dialog**: `role="dialog"`, `aria-modal`, `aria-labelledby`,
  plus `appFocusTrap` (`shared/a11y/`), which confines Tab and restores focus on close.
  Written by hand rather than pulling in `@angular/cdk` for a single directive.
- **The space switcher is a real menu**: `aria-expanded`, `aria-haspopup`, focus moved into
  the menu on open, arrow/Home/End navigation, Escape closing and restoring focus. Creating a
  space _replaces_ the menu with a form instead of nesting a text field inside `role="menu"`,
  which is neither valid ARIA nor navigable the same way; Escape then steps back to the menu
  before closing the dropdown.
- **Controls that wrap decorations get an explicit `aria-label`.** The search input sits
  inside a `<label>` that also holds the magnifier and the shortcut hint; without one, the
  field would be announced as "🔍 Ctrl+K".
- A `<button>` contains only phrasing content — nested `<div>` is invalid HTML with
  undefined accessibility behaviour.

## Theming

All colors, fonts and shadows are CSS custom properties defined on `:root` in the global
`src/styles.scss`; components only consume them via `var(…)`.

Those variables **must** stay in the global stylesheet. Angular's emulated encapsulation
rewrites a `:root` selector written inside a `*.component.scss` into a form that never
matches `<html>`, silently invalidating every variable.

Recurring style patterns (unstyled control, card surface, accent state, tinted badge) are
SCSS mixins in `src/styles/_mixins.scss`, imported as `@use 'mixins' as *;` — resolved via
`stylePreprocessorOptions.includePaths` in `angular.json`. Colors needing translucency are
also exposed as RGB triplets (e.g. `--amber-rgb`) so `rgba()` never hard-codes a hex value.

`styles.scss` also carries the `.visually-hidden` utility and a `prefers-reduced-motion`
block.

Fonts are self-hosted through the `@fontsource` packages listed in `angular.json`'s `styles`
array. They used to come from Google Fonts, which on a desktop app meant degraded typography
offline and a CSP that could not be locked down.

## Tauri configuration

- `src-tauri/tauri.conf.json` wires the pipeline to Angular: `beforeDevCommand` /
  `beforeBuildCommand` run the npm scripts, `devUrl` must match the Angular dev server port
  (1420, fixed in `angular.json`), and `frontendDist` must match Angular's build output path.
- `src-tauri/capabilities/default.json` is the v2 permission manifest for the main window.
  Any new plugin or restricted API needs its permission listed there, or the call is denied
  at runtime.
- **CSP is enabled.** `csp` locks production down to same-origin resources; `devCsp`
  additionally allows the dev server's websocket and inline scripts for hot reload. Both
  keep `ipc:` and `http://ipc.localhost` in `connect-src` — without them `invoke()` is
  blocked. Loading anything remote means widening these, deliberately.

## Testing

Unit tests run with Vitest through the `@angular/build:unit-test` builder in a jsdom
environment (configured in `angular.json`'s `test` target and `vitest-base.config.ts`), so
no browser is needed. Specs sit next to the file they cover. Coverage thresholds are set at
80% and enforced by `npm run test:coverage`.

Test descriptions and comments are written in **English**, the one deliberate exception to
this repo's French-first convention.

Shared helpers live in `src/testing/`, which is outside the `**/*.spec.ts` include and so
never collected as tests: `Note` and `NoteSection` fixture builders, in-memory repository
doubles, and `provideAppTesting()` — one call providing both repositories and Transloco, so
a new data seam does not have to be added to a dozen spec files by hand.

`FakeNotesRepository` and `FakeSpacesRepository` behave like real persistence (they own the
list and assign ids and timestamps) and expose `failNext`, which is what makes the stores'
rollback paths testable at all.

Component specs follow one consistent pattern:

- Render the component with its **real** children — they're standalone and already declared
  in the component's own `imports`, so no extra wiring is needed. Don't stub children or
  mock Angular's DI.
- Assert against a child's public contract only: read its input signals, and call or
  subscribe to its output emitters. Don't reach into a child's rendered DOM — that child's
  behavior is covered by its own spec. Note that a `model()` exposes its change output
  through the signal itself, not as a separate `xChange` property.
- Do `TestBed.createComponent(...)` and set required inputs in `beforeEach`, not in a
  per-test helper, so every spec shares one setup path.
- Call `fixture.autoDetectChanges()` once in `beforeEach` (it also performs the initial
  render), then `await fixture.whenStable()` after any state change before asserting on the
  DOM. This lets Angular's own scheduler decide when to re-render, as it would in
  production, instead of forcing synchronous checks.
- For date-dependent output (relative time, expiry), use
  `vi.useFakeTimers({ toFake: ['Date'] })` with `vi.setSystemTime(...)`. **Never** call
  `vi.useFakeTimers()` without a `toFake` list here: it also fakes `requestAnimationFrame`,
  which the zoneless scheduler relies on, and `await fixture.whenStable()` will hang forever.
  `clock.service.spec.ts` is the one exception — it asserts on the interval itself.
- Anything asserting on `document.activeElement` must attach `fixture.nativeElement` to the
  document; jsdom does not track focus for detached elements.
- Assert on text through a whitespace-normalising helper. Two templates deliberately keep
  their interpolations on a single line (and carry a `prettier-ignore`) because Angular does
  not fully collapse the whitespace a line break would introduce.
- For anything that transitively needs a store, use `provideAppTesting()` and spy on the real
  store's methods rather than re-implementing a fake store — stores have their own specs.

### Rust

`cargo test` from `src-tauri/` runs the persistence and serialisation tests. There is still no
linter or formatter configured (no clippy or rustfmt hook).

Persistence tests run against `storage::open_in_memory()`, which applies the real migrations —
so they exercise the actual schema, constraints and cascades, not a simplified stand-in. They
pass timestamps explicitly instead of reading the clock, which is what makes assertions on
`created_at` / `updated_at` deterministic. Test names and comments are in English, like the
front-end specs.
