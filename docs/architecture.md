# Architecture

How DevBox is put together, and the conventions to follow when extending it.
For build/run instructions see the [README](../README.md).

## Overview

DevBox is a Tauri v2 desktop app: an Angular single-page front-end rendered in a WebView,
and a Rust process that owns everything native (storage, and later hashing and filesystem).
The two halves talk only through Tauri's `invoke()` bridge.

Notes and spaces are complete end to end: the front-end has no in-memory dataset left, every
read and write goes through `invoke()`, and the Rust commands persist to an embedded SQLite
database. The planned domains (crypto, formatters) have **no** module of their own yet: a
placeholder would ship dead code in the binary, and an empty file documenting a contract
drifts from whatever eventually gets written.

**Where the work happens.** Data processing belongs to Rust. Filtering (space, full-text,
tags, languages, quick filters), grouping into display sections, facet aggregation and tag
normalisation, and the choice of what a card's footer shows all run in `src-tauri/src/domain/`.
The front-end describes what the user asked for and renders the view it gets back — it does
not filter, sort or group. The deliberate exceptions are relative-time **formatting** (labels
must age on their own, without a round trip), the ISO ↔ `Date` conversion at the serialisation
boundary, syntax highlighting (it colours the in-flight editor draft, which is not persisted
yet — a round trip per keystroke), and plain UI concerns like keyboard shortcuts and drafts.

```
src/                Angular front-end
├── app/
│   ├── core/       cross-cutting infrastructure, one folder per subject:
│   │               IPC, i18n, errors, time, preferences, updates, app-info, language
│   ├── features/   one folder per tool, owning its data/, model/, state/ and ui/
│   ├── layout/     the app chrome: shell, titlebar, about, error banner, update prompt
│   └── shared/     presentation kit — a11y directives and components that inject nothing
├── assets/         static images
├── styles/         global theme (styles.scss) and SCSS partials
└── testing/        test doubles, fixtures and shared providers
src-tauri/          Rust back-end
├── src/domain/     model and business rules — knows neither SQLite nor Tauri
│                   (note, view, sections, space, rules)
├── src/storage/    SQLite persistence: schema, migrations, SQL only
├── src/commands/   Tauri adapters: lock, delegate, translate the error
├── src/lib.rs      Tauri builder, database setup + command registration
└── capabilities/   Tauri v2 permission manifests
```

### The three Rust layers

Dependencies point one way — **`commands/ → domain/ ← storage/`**. The persistence layer
knows how to read and write the model, the transport layer knows how to serialise it, and
neither one defines it. (Before the domain layer existed, the model lived in `commands/` and
`storage/` imported it from there, which pointed persistence at transport.)

Two greps enforce it, and are worth running after any structural change:

```bash
grep -rn "rusqlite\|tauri::" src-tauri/src/domain/    # must be empty
grep -rn "use crate::commands" src-tauri/src/storage/ # must be empty
```

The payoff is concrete: the domain tests run without opening a database. `cargo test domain::`
covers section placement, timezone boundaries, tag normalisation, search folding, footer
choice and expiry thresholds in a few milliseconds, with no fixture setup.

`domain/` is five modules, grouped by what they answer rather than by function:

| Module        | Holds                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `note.rs`     | what a note **is** (`Note`, lifecycle, draft, patch) and how it is **shown** (`NoteFooter`, `DisplayNote`, `decorate`) |
| `view.rs`     | what is asked (`NotesQuery`, `NoteFilter`) and what comes back (`NotesView`, `NoteSection`), plus `build()`            |
| `sections.rs` | chronological placement and the timezone arithmetic it needs                                                           |
| `space.rs`    | the space and its move-target rule                                                                                     |
| `rules.rs`    | validation and matching: `ValidationError`, languages, tag normalisation, search                                       |

The split is deliberately coarse. A module per function meant four files wrapping one
function each, four module headers, and a reader chasing `normalize` across the tree.

Serde attributes sit on the domain types rather than on a separate DTO family. At this size a
second set of types and their mapping would cost more than it protects; the wire shape is
pinned by tests in `domain/note.rs`, `domain/view.rs` and `domain/space.rs` instead.

## Front-end

### Where a file goes

> A feature owns its data, its model, its state and its components. `core/` is cross-cutting
> infrastructure — one folder per subject, a service and its store together. `shared/` is a
> presentation kit: nothing in it injects. `layout/` is the chrome around the tools.

The axis is the **subject**, never the technical nature. There is no `stores/` folder holding
every store, because that files one domain under four addresses; `UpdateStore` sits beside
`UpdaterService` in `core/updates/`, and `NotesStore` sits in `features/notes/state/`. State
lives beside what it manages.

The payoff is the second tool: `features/hashing/` will hold `{data,model,state,ui}` and its
page, the slots it does not need simply will not exist, and **nothing in `core/` moves**. The
inverse test is just as useful — deleting `features/notes/` deletes the notes feature and
leaves nothing dangling.

Membership is decidable, not a matter of taste:

| Folder      | Test                                                          |
| ----------- | ------------------------------------------------------------- |
| `features/` | does one tool need it, and no other?                          |
| `core/`     | would a second, unrelated tool inject it verbatim?            |
| `shared/`   | does it take everything through `input()` and inject nothing? |
| `layout/`   | is it the frame around a tool rather than part of one?        |

That last rule is why `ErrorBannerComponent`, `UpdatePromptComponent` and
`AboutDialogComponent` live in `layout/` and not in `shared/ui/`: they inject. And why
`LifecycleBadgeComponent`, which reads `NoteLifecycle`, lives under `features/notes/ui/`.

### Imports

Path aliases rather than deep relative paths: `@core/*`, `@shared/*`, `@features/*`,
`@layout/*`, `@testing/*` (declared in `tsconfig.json`). The rule is **relative when a single
`../` reaches the target, alias otherwise** — so `features/notes/state/notes.store.ts` reads
`../data/notes.repository`, while `features/notes/ui/note-card/` reaches the model through
`@features/notes/model/note.model`. There is no `../../` anywhere in `src/`, and that is worth
keeping: it is the property that makes an import line readable without opening a file tree.

**No `index.ts` barrels.** Three reasons, in order of weight: a barrel at
`features/notes/index.ts` would pull `data/`, `state/` and every `ui/` component into the lazy
chunk _while hiding that it does_ — the explicit `loadComponent` path is what keeps the chunk
honest; barrels re-close import cycles by construction, and this codebase has one deliberate
cycle broken by hand (`core/ipc` ↔ `features/notes/data`, see below); and with five aliases the
import lines are already short. The tree has zero barrels — keep it that way.

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
feature. Components specific to notes live under the feature's own `ui/` folder, next to the
page that composes them.

Components never reach into each other imperatively. A keyboard shortcut belongs to the
component that owns the affected element: `Ctrl/⌘+K` is handled inside `SearchBoxComponent`,
which also renders the hint, rather than travelling down a chain of `viewChild` calls.

A component that only relays inputs and outputs is not a component. The page composes
`SpaceSwitcher`, `SearchBox`, `FilterChips` and `NoteSection` directly rather than through a
topbar and a canvas wrapper, which added two files and eleven declarations without a single
decision between them.

### Shared behaviour lives in directives, not in copies

Three menus (space switcher, card actions, about) and three modals (editor, about, update
prompt) share their interaction rules. Those rules live in `shared/a11y/`, and are applied
through `hostDirectives` so no wrapper element is needed:

| Directive                 | Selector                                  | Owns                                                                              |
| ------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| `MenuTriggerDirective`    | `[appMenuTrigger]`, `exportAs: 'appMenu'` | open state, outside click, Escape, focus returned to `[appMenuAnchor]`            |
| `MenuPanelDirective`      | `[appMenuPanel]`                          | `role="menu"`, focus on the first entry, arrows and Home/End over `[appMenuItem]` |
| `DialogBackdropDirective` | `[appDialogBackdrop]`                     | dismissal when the click lands on the backdrop itself                             |
| `FocusTrapDirective`      | `[appFocusTrap]`                          | keyboard focus confined to a dialog, restored on destroy                          |

Two details are load-bearing:

- `MenuPanelDirective` walks `[appMenuItem]` rather than every button, because a menu may
  carry a secondary action deliberately outside the arrow cycle — the `⋯` that opens a
  space's edit panel is reachable by Tab, not by arrows.
- `MenuTriggerDirective` **emits** `escaped` instead of closing on Escape. A single-level menu
  wires it straight to `close()`; the space switcher first collapses its create/edit panel and
  only closes on the second press.

Putting the click listener in a directive also removes the `click-events-have-key-events`
suppressions the three modal templates used to carry: the keyboard equivalent exists, it is
Escape, and the template no longer declares a bare `(click)` for the linter to flag.

The matching CSS lives in `src/styles/_mixins.scss` as `backdrop($z-index)` and
`dialog-panel($width)`. The z-index stays with the caller: the stacking order (editor 50,
about 55, update 60) is a decision, not an implementation detail.

### Syntax highlighting

`CodeViewerComponent` renders read-only coloured code — a card excerpt, or the layer under the
editor's textarea. It delegates to `shared/ui/code-viewer/highlighter.ts`, the **only** module
that imports highlight.js.

- **Grammars are imported one by one** from `highlight.js/lib/`, never the default bundle,
  which carries close to 200 languages. `GRAMMARS` maps a `LanguageTag` onto the grammar that
  describes it; three do not share a name (`toml` is `ini`, `html` is `xml`, `yml` is `yaml`),
  and `txt` deliberately has none — free text has nothing to colour, so it is only escaped.
- **`ignoreIllegals` is on.** A note is free text, often a fragment that does not parse end to
  end; without it a truncated JSON snippet would throw instead of rendering.
- **Output is re-split into lines** by `splitHighlightedLines`. highlight.js colours the whole
  block — that is exactly what lets it handle a comment or string spanning several lines — but
  the viewer renders one element per line for its gutter. A plain `split('\n')` would cut
  through `<span>`s straddling a line break, so the splitter tracks the open tag stack, closes
  it at end of line and reopens it on the next.
- **The theme is global**, in `src/styles/_code-theme.scss`. The coloured HTML arrives through
  `[innerHTML]`, and Angular does not stamp `_ngcontent-*` on DOM created that way: a
  `.hljs-keyword` rule written in `code-viewer.component.scss` would be rewritten into
  `.hljs-keyword[_ngcontent-xxx]` and never match. No highlight.js stylesheet is imported —
  they hard-code hex values, where the rest of the app only reads theme variables.
- **The markup is never trusted.** highlight.js escapes the source text and the result still
  goes through Angular's sanitizer; nothing calls `bypassSecurityTrust*`, and nothing should —
  the content is typed by the user.
- Two inputs let a card reuse it: `showLineNumbers` (a gutter on a three-line excerpt is
  noise) and `compact` (no padding, no scroll, no font size of its own — the card decides).
  The viewer renders `<span>`s rather than `<div>`s for the same reason: a card is a
  `<button>`, whose content model only admits phrasing content.

### State

`NotesStore` (`providedIn: 'root'`) holds the **query state** — search text, active filter,
selected tags, selected languages, selected note — and the view the back-end returned for it.
It does no filtering, sorting or grouping of its own: those criteria are sent to
`query_notes`, and `sections`, `allTags`, `allLanguages`, `isFiltering` and `hasNoResults` are
all reads of the resulting `NotesView`.

⚠️ Any new query criterion needs three edits in lockstep: a field in `QueryParams`, its clause
in `sameQueryParams`, and the copy into the `NotesQuery` the loader builds. `resource` compares
its params by identity, so a criterion missing from the comparator changes nothing on screen —
the rail looks wired and simply never refetches.

Two consequences worth knowing:

- **The search is debounced (`SEARCH_DEBOUNCE_MS`, 150 ms).** The field updates on every
  keystroke so typing never lags, but the query crosses the IPC bridge, and one round trip
  per character would be wasted work.
- **The last view is kept during a reload** (a `linkedSignal` over the resource). Otherwise
  each debounced keystroke would blank the canvas and the list would flicker between
  "Loading…" and the results. `isLoading` is therefore true only until the _first_ view
  arrives. That `linkedSignal` only retains what it has been read through, so everything the
  store exposes reads it, and `isLoading` does so without short-circuiting.

`SpacesStore` owns the spaces and the active one. Two decisions matter there:

- **The active space is a filter, not a label.** `NotesStore` injects `SpacesStore` (never the
  other way round) and sends `activeSpaceId()` with every query, so the space also scopes both
  facet rails — a tag or a language that filters nothing in the current space has no reason to
  be offered.
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
- **The view is a parameterised `resource()`.** Its params are the query criteria plus the
  current **local day** — not `clock.now()`, since only the day affects section boundaries.
  The exact instant is read `untracked` in the loader. `resource.value()` **throws** while
  the resource is in error; read it through a `hasValue()` guard.
- **That params `computed` needs its `equal` comparator.** `resource` compares its parameters
  by identity, and `queryParams` builds a fresh object literal that depends on `clock.now()`.
  Stabilising the day _value_ is not enough — without `sameQueryParams`, every 30 s tick
  produced a new object, a new request, and a full `query_notes` + SQLite round trip, hidden
  by the retained view and by `isLoading` staying false. A spec covers it: a clock tick must
  not increment `queryCount`.
- **The back-end is authoritative; writes are not optimistic.** A mutation persists, adopts
  the returned note, then reloads the view. Nothing is applied locally first, so there is
  nothing to roll back on failure — an `ErrorNotifier` message is raised and the screen still
  shows what is actually stored. A write can move a note between sections, which is precisely
  why the view is recomputed rather than patched.
- **Ids, timestamps and normalisation come from persistence**, never from the front-end.
- Derived state is `computed()`, never a manually maintained signal.
- Formatting logic that needs no injection lives beside its subject (relative time in `core/time/`) as pure functions taking
  `now: Date` as a parameter.

### Display sections

Sections are built in Rust (`src-tauri/src/domain/sections.rs`) and arrive ready to render.
The front-end preserves the order it receives and never drops or merges a section.

The classification into `pinned`, `today`, `week` and `older` is **exhaustive**: apart from
pinned notes, each note falls into exactly one section — a note belonging to no section is
unreachable in the UI, search included. An unparseable `created_at` lands in `older` rather
than disappearing. The `week` section is always present because it hosts the "paste or
create" ghost card.

As soon as a search query or a tag selection is active, the view collapses into a single flat
`results` section. Spreading search results across date sections dilutes them and hides
matches at the bottom of the page. A quick filter (`pinned` / `untriaged`) does **not**
trigger this: it narrows a view that stays chronological.

Day boundaries are **local**, so the query carries `tzOffsetMinutes` alongside `now`. Without
it a note created at 23:00 would be filed under the wrong day. Beware the sign: JavaScript's
`getTimezoneOffset()` returns −120 for UTC+2, the opposite of what chrono's `FixedOffset`
expects.

A section's key **is** its translation key (`'sections.' + key`), which is why the Rust enum
serialises to `"pinned"` / `"today"` / … and no user-visible label ever crosses the bridge.

### What a card's footer shows

The footer carries one of three things, and which one is a **product rule**, so it is decided
in `domain::display` and arrives as a tagged `footer` field:

| variant  | when                         | rendered as                |
| -------- | ---------------------------- | -------------------------- |
| `expiry` | the note has a deadline      | `expiryRef(at, now)`       |
| `source` | pinned, and it has a context | the first path segment     |
| `age`    | everything else              | `relativeTimeRef(at, now)` |

The dated variants carry a **date, not a label**: formatting stays on the front so "4 min ago"
keeps ageing on screen without a round trip. That is the line — the back decides _what_ to
show, the front decides _how_.

`expiringSoon` comes with it, computed against a single threshold in `domain::display`. It
previously lived only on the front (`isExpiringSoon`, 3 days) while the back separately
computed `has_expiring_notes` — two definitions of "soon" behind a hint that reads "to triage
soon". The section flag now derives from the same per-note value.

### "Untriaged" — the ephemeral note

In the product model, a note carrying a deadline is a note whose fate has not been decided
yet: that is what the `untriaged` quick filter selects, what the `⏳` lifecycle badge shows,
and what the "to triage soon" section hint counts. All of it hangs on one field, `lifecycle`.

The deadline is set from the editor's date field, next to the badge: an empty field means
permanent, a date means expiring. The value is turned into the **end of the local day**
(`endOfLocalDay`), not midnight — a note dated today would otherwise be expired the moment it
was set — and the reverse conversion is local too, or the field would show the previous day
west of Greenwich. This is the same class of exception as relative-time formatting: an
`<input type="date">` value is a UI representation, not a business rule.

Until that field existed, every note was created permanent and nothing could ever change it,
so the filter, the badge and the section hint were all reachable but permanently empty.

### The card actions menu

`NoteCardMenuComponent` is the `⋯` menu on a card: move the note to another space, or delete
it. It is a separate component from `NoteCardComponent` because it brings what the card has
none of — open/closed state, a document-click listener, focus management — leaving the card
purely derived from its note.

Two structural consequences:

- The card's root is a `.card-shell` wrapper, not the `<button>` itself. A `<button>` may not
  contain another `<button>`, and the menu trigger is one. The shell also anchors the menu
  (`position: relative`) and is what the trigger watches to appear on hover
  (`:host-context(.card-shell:hover)`).
- The pin indicator moved out of `.card.pinned::after` into the first row of the card, since
  the menu now occupies the top-right corner.

The trigger stops propagation: the whole card is a button, so without it a click on `⋯` would
open the editor at the same time as the menu. The trigger is `opacity: 0` rather than
`display: none` — hiding it would take it out of the tab order and make the menu unreachable
by keyboard. The menu emits no note id (it does not know one); the card attaches it, the same
way the editor lets the store decide which note is open.

### Managing spaces from the switcher

The space switcher's dropdown has three mutually exclusive states: the menu, the creation
form, and the per-space edit panel (rename + delete). Each **replaces** the menu instead of
nesting inside it — a text field or a `<select>` inside a `role="menu"` is neither valid ARIA
nor navigable the way options are. Escape unwinds one level at a time.

The delete control only appears when another space exists to receive the notes; with a single
space the panel explains why rather than offering a button that could only fail. Each space
row is a `role="none"` wrapper holding the select button and the `⋯` trigger, so the menu
keeps its direct menuitem children. Arrow-key navigation stays on the select buttons only.

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

The body is **two stacked layers**, not a preview/edit toggle: `CodeViewerComponent` colours
the draft underneath, and a textarea sits on top with `color: transparent` and a visible
`caret-color`. The note stays highlighted while it is being typed, and there is no mode to
enter. Consequences worth knowing:

- The textarea's metrics must match the viewer's **exactly** or the caret drifts off the
  coloured text: same font, size and `line-height`, same `white-space: pre-wrap` /
  `word-break: break-word`, and a `padding-left` that adds the viewer's line-number gutter to
  its 24px padding — hence `padding: 20px 24px 20px 56px`. The gutter is **32px, not 48px**:
  `.line-no` is `width: 32px; padding-right: 16px`, and the global `* { box-sizing:
border-box }` folds that padding into the width. Getting this wrong shifts typing by two
  characters while looking perfectly aligned, because the caret is drawn by the textarea at
  its own — wrong — position.
- The **scroller is the wrapping `.overlay-body`**, never the textarea. The viewer, in normal
  flow, gives `.editor-stack` its height; the textarea is `position: absolute; inset: 0` over
  it and so never overflows internally. Both layers therefore scroll together with no
  `scrollTop` synchronisation to maintain. `.editor-stack` is `min-height: 100%` so a click in
  the empty space below a short note still reaches the field.
- The viewer is `aria-hidden` and `pointer-events: none`: the textarea carries the accessible
  text and every interaction, otherwise a screen reader reads the body twice.
- Escape leaves the body before closing the overlay (`onEscape` blurs the textarea when it
  holds focus), so a keystroke aimed at the field does not dismiss the whole modal.

Deletion is a two-step confirm in the toolbar rather than a native `confirm()`, which would
freeze the whole WebView. The fullscreen toggle expands the panel to fill the backdrop and
persists through `PreferencesService`.

### Data access

Stores never talk to a data source directly. They inject `NOTES_REPOSITORY` /
`SPACES_REPOSITORY`, and `app.config.ts` binds those tokens — **the single
place where the application's data source is chosen**. Both are bound to the `Tauri*`
repositories; the only remaining doubles are the test ones in `src/testing/`, injected by
`provideAppTesting()`.

The notes contract is `query` / `create` / `update` / `delete`; spaces expose `loadAll` /
`create` / `rename` / `delete`. There is deliberately **no method returning the raw list of
notes** — offering one would invite a caller to filter it again.

`SpacesRepository.delete` takes a refuge (`delete(id, targetSpaceId)`) rather than an id
alone: a one-argument signature would have made data loss the default, since the schema
cascades. Moving a single note needs no dedicated method — `spaceId` is part of `NotePatch`,
and `NotesStore.moveNote` is a thin wrapper over the ordinary update path.

`SpacesStore.deleteSpace` returns a boolean and does **not** reload the notes: it does not
know `NotesStore` (the reverse dependency already exists, and closing the loop would be an
injection cycle). `NotesPageComponent` chains the reload, which matters when the current
query does not mention the deleted space and would otherwise show nothing new.

Keep this seam intact: no component calls `invoke()`, and `IpcService` is its only caller.

## IPC boundary (Angular ↔ Rust)

All calls go through `IpcService` (`core/ipc/`) and every failure comes back as an `IpcError`.

The command **and its arguments** are typed by the `IpcContract` table in
`core/ipc/ipc.service.ts`, mapping
each command name to its argument shape and return type. This matters more than it looks:
Tauri matches arguments **by name**, so a misspelled key used to compile fine and fail at
runtime as a serde rejection — an `IpcError` with no code, the most opaque failure the app
can produce. It is now a build error.

### Error contract

Commands return `Result<T, AppError>`, never `Result<T, String>`. An `AppError`
(`src-tauri/src/commands/error.rs`) carries a stable **code**, its interpolation **params**
and a technical **detail**:

```json
{ "code": "duplicateSpaceName", "params": { "name": "Perso" }, "detail": "Un espace nommé …" }
```

This exists because business rules live in Rust. A message written there would be French in
an English UI, and branching on a cause would mean parsing a sentence that breaks at the
first rewording.

The mapping lives in **one** place, `core/errors/error-notifier.service.ts`: `ipcNotice(error, fallback)`
turns a failure into the message that helps most. A named cause wins over the attempted
action — "this note no longer exists" beats "could not save the note", which would leave the
user retrying something that can never succeed. `fallback` is used when the cause adds
nothing actionable (a generic SQLite failure) or when there is no code at all.

Its table is typed `Record<IpcErrorCode, string | null>`, so adding a variant to
`IpcErrorCode` fails the build until its key is decided. That is what makes the Rust ↔ front
mirror compiler-checked rather than review-checked.

`IpcError.code` is `null` when the rejection is not one of ours: Tauri itself rejects with a
plain string for an unknown command or an argument that fails to deserialise, and that case
must stay readable. It is also `null` for a code this build does not recognise —
`isIpcErrorPayload` validates the string against the known list rather than trusting it, so
the declared type cannot lie at runtime.

`ErrorCode` has no variant for a too-recent schema: that failure is only produced by the
migration during Tauri's `setup()`, where it aborts startup. No command can return it, so
giving it a code would advertise a case the front can never handle.

### Serialisation contract

`features/notes/data/note.dto.ts` defines what actually travels over the bridge and converts it to the
domain model. Two traps it exists to handle:

- **JSON has no date type.** Every `Date` becomes an ISO 8601 string on the wire. The mapper
  parses it back and throws a `NoteContractError` on an unparseable value, rather than
  letting an `Invalid Date` propagate and resurface as `NaN` in a relative-time label.
- **Serde's defaults do not match the TypeScript shape.** The Rust `Note` struct needs
  `#[serde(rename_all = "camelCase")]` (otherwise the front receives `space_id` /
  `created_at` where it expects `spaceId` / `createdAt`), and the
  lifecycle enum needs `#[serde(tag = "kind", rename_all = "camelCase")]` (otherwise serde
  emits `{"Expires":{…}}`, which the discriminated union does not recognise).

An unknown `language` value degrades to `txt` instead of failing the load, and an unknown
entry in `availableLanguages` is dropped from the rail: a newer backend may know a language
this front-end build does not. Contrast with an unknown section key, which does throw — a rail
missing one facet stays usable, a canvas with an unreadable section does not.

The known list is `domain/language.rs` (`LANGUAGES`), mirrored by `core/language/language.model.ts`
(`LanguageTag` + `LANGUAGE_LABELS`). Adding a language means editing both, plus a `.lang-*`
rule in `language-badge.component.scss` and, if it should be coloured, an entry in `GRAMMARS`.
Nothing compares the two lists, so a drift only surfaces at runtime as a fallback to `txt`.

Patches are serialised field by field, omitting absent keys — an explicit `undefined` would
serialise to `null` and overwrite the stored value instead of leaving it untouched.

### Rules

- Argument names must match between the TS call site and the Rust signature — Tauri matches
  by name, not position. Declare each command in `IpcContract` and the compiler enforces
  it. ⚠️ Tauri v2 applies `rename_all = "camelCase"` to arguments, so a Rust parameter
  `note_id` is `noteId` on the wire. No parameter is multi-word today, but the first one will
  hit this.
- **Every** command must be registered in `tauri::generate_handler![...]` in
  `src-tauri/src/lib.rs`, or the call fails at runtime even though the Rust compiles fine.
- Commands are **adapters only**: validate the input, lock the shared connection, delegate,
  translate the error. A command that grows is a sign a rule was written in the wrong place.

The eight commands are `query_notes`, `create_note`, `update_note`, `delete_note`,
`list_spaces`, `create_space`, `rename_space` and `delete_space`. The guarantees the
front-end relies on (persisted value returned, `Err` on an unknown id, "absent field means
unchanged" for patches) are implemented in `storage/` and `domain/`, and tested there.

`delete_space` takes a **refuge** (`targetSpaceId`) and is the one command whose argument is
multi-word, so it is the first to actually exercise Tauri's camelCase renaming. The refuge is
not optional: `notes.space_id` carries an `ON DELETE CASCADE`, so a bare delete would take
the notes with it. `storage::spaces::delete` moves them and drops the space in one
transaction, in that order, and deliberately leaves `updated_at` alone — the canvas orders on
that column, and refreshing it would float the whole absorbed space to the top as if every
note had just been edited. A space cannot be its own refuge (`domain::space::validate_move_target`);
the cascade would take the notes back out one statement after the move.

`query_notes` takes a `NotesQuery` (space, search, quick filter, tags, languages, `now`,
`tzOffsetMinutes`) and returns a `NotesView` (sections, `availableTags`, `availableLanguages`,
`isFiltering`, `matched`). The pair `isFiltering` + `matched` is what lets the UI distinguish
"no results" from "this space is empty" without recomputing anything. Its two steps are
visible in the command body: `storage::notes::fetch` runs the indexed SQL, `domain::view::build`
applies the rules to what came back. `fetch` returns the notes plus a `Facets { tags,
languages }` — the two rails ask the same question of two columns, and passing two bare
`Vec<String>` side by side would be indistinguishable at the call site.

**Tags and languages are both facet rails**, and behave identically: union semantics (a note
passes if it carries _at least one_ of the selected values), facets scoped to the space rather
than to the current filter, and a selection counts as `is_filtering` — which collapses the
canvas into a single flat `results` section. The quick filters (pinned / untriaged) do not:
they narrow a view that stays chronological. One asymmetry: selected tags go through
`domain::rules::normalize_tags` before hitting SQL, selected languages do not — a language is picked
from a closed list, not typed, and `domain::language` compares it exactly.

The serialisation contract is pinned by tests in `domain/note.rs`, `domain/query.rs`,
`domain/display.rs` and `domain/space.rs` rather than left to review: they assert the emitted
JSON keys are camelCase, that a lifecycle serialises to `{"kind":"expires","at":…}`, that a
section key serialises to `"older"`, that a decorated note serialises **flat**, and that an
error code serialises to `"noteNotFound"`. A serde attribute deleted by accident fails
`cargo test` instead of silently breaking the UI.

### Input validation

The back validates what the front already constrains, because a rule held only by a form is
not held at all. `domain/rules.rs` defines a `ValidationError` carrying the offending
`field`; commands call `draft.validate()` / `draft.validated_name()` before touching the
connection, and `AppError` turns the refusal into `invalidInput` with `{{field}}`.

What is checked: `language` against the known list (an arbitrary value would be unreadable by
any front build), a space name trimmed and non-empty (`COLLATE NOCASE` folds case but not
whitespace, so `"Perso "` would otherwise sit beside `"Perso"`, identical on screen), and
`NotesQuery.now` as a parseable instant — falling back to the server clock would silently
re-cut every section on a different day.

## Persistence (Rust)

Storage is **SQLite**, embedded through `rusqlite` with the `bundled` feature — SQLite is
compiled from source and statically linked, so nothing has to be installed or shipped
alongside the executable. The database file lives in Tauri's `app_data_dir()`.

- **Layering.** `storage::notes` and `storage::spaces` are plain functions taking a
  `&Connection`; the `#[tauri::command]`s sit on top. That is what makes persistence testable
  against `Connection::open_in_memory()` without launching Tauri. This layer holds **no
  business rule** — it reads and writes the model defined in `domain/`, which it depends on.
- **Concurrency.** A rusqlite `Connection` is not `Sync`. A single connection is shared as
  `tauri::State<Db>` (`Db = Mutex<Connection>`), registered with `.manage()` in `lib.rs` —
  never a global. Overlapping commands serialise on that mutex.
- **Migrations.** The schema is versioned by `PRAGMA user_version`. Evolving the model means
  adding a `MIGRATION_N` constant and a branch in `migrate` — never editing a shipped
  migration, it has already run on user machines. Each migration is atomic. A database written
  by a newer build is refused rather than misread.
- **Schema choices that made filtering movable to the back-end.** `lifecycle` is split into
  `lifecycle_kind` + `lifecycle_expires_at` columns rather than stored as JSON, and tags live
  in their own `note_tags` table rather than in a serialised column. Both exist so that
  filtering by tag, or querying what expires before a date, is a `WHERE` clause instead of a
  full re-read — which is why `query_notes` needed no migration. `PRAGMA foreign_keys` is set
  per connection, which is what makes the `ON DELETE CASCADE` on notes and tags actually fire.
- **Ordering is the back-end's call.** `storage::notes::fetch` orders by `updated_at DESC, id`;
  the front-end preserves the order it receives, so this one query decides what the user sees
  first. Note the deliberate asymmetry: the order is by `updated_at` while sections group by
  `created_at`. The section answers "when was this note born", the order within it answers
  "which did I touch last", so an old note reopened today tops the "older" section.
- **Querying splits the work by what each tool does well.** SQL handles what it indexes —
  space, pin state, lifecycle, language, and tag membership through `EXISTS` on `note_tags`.
  Full-text
  matching is done **in Rust** (`domain::search`), because SQLite's `LOWER()` only folds ASCII
  without ICU, so `Étape` would not match `étape`. Grouping is `domain::sections`, which
  touches no connection and is therefore testable without a database.
- **Tag normalisation lives in `domain::rules::normalize_tags`, and only there.** Trimming,
  stripping leading `#`, dropping blanks and collapsing case-insensitive duplicates (first
  spelling wins) all happen on write, so the front sends what the user typed. The returned
  tags are sorted to match what a read gives back — otherwise a note's tags would reorder
  themselves on the next reload.
- **Tag case folds at the storage level too.** `note_tags.tag` is `COLLATE NOCASE`
  (migration 2). Without it `normalize` only deduplicated _within_ one note: `Urgent` and
  `urgent` carried by two different notes produced two facets in the rail, of which
  `tag IN (…)` — running in BINARY — matched only one, while the text search confused them.
  Three behaviours for one concept.
- **`notes.language` is indexed** (migration 3), since it became a filtering facet: both
  `language IN (…)` and the `SELECT DISTINCT language` that feeds the rail would otherwise
  scan the table on every query. No `CHECK` constraint on the column, though — the list of
  known languages lives in `domain::language` and moves between versions; freezing it in the
  schema would mean a migration per addition.
- **Timestamps are injected, not read.** `storage::notes` takes `now` as a parameter and the
  command passes `storage::now_iso()` — the same reason `ClockService` exists on the front.
  Millisecond precision is deliberate: two notes saved within one second would otherwise be
  impossible to order.

## Cross-cutting services

- **`ClockService`** (`core/time/`) exposes `now` as a signal ticking every 30 s. Relative
  time computed with `new Date()` inside a `computed()` freezes: the computed depends on no
  signal representing time, so it never re-evaluates and a card shows "4 min ago" forever.
  Injecting `now()` makes those computeds both pure and self-refreshing.
- **`PreferencesService`** (`core/preferences/`) stores UI preferences in a real file through
  `tauri-plugin-store` (`preferences.json` in `app_config_dir()`), readable from Rust and
  immune to a WebView cache wipe — unlike the `localStorage` it replaced. Two consumers:
  `LocaleService`, and the editor overlay's fullscreen toggle (`devbox.editorFullscreen`).
  - **The API stays synchronous** although the plugin's is not: both consumers read at
    construction time, and an async read would show the interface in one state then the
    other. The file is loaded **once** by `hydrate()` from an app initializer, into an
    in-memory cache; writes hit the cache immediately and are pushed without being awaited.
  - The plugin is reached through the `PREFERENCES_STORE_LOADER` token rather than by calling
    `load` directly. Beyond the usual seam argument, it is a practical necessity: the Angular
    builder bundles modules before Vitest sees them, so `vi.mock` on an external package
    intercepts only intermittently. Outside Tauri the loader rejects and the service degrades
    to a memory-only cache, which is how every other spec runs.
  - `hydrate()` adopts any `devbox.*` key left in `localStorage` by an earlier version, then
    clears it. Without that, updating the app would silently reset the interface language.
  - Adding a plugin also means declaring its permission (`store:default`) in
    `src-tauri/capabilities/default.json`, or the call is refused at runtime.
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
`src/styles/styles.scss`; components only consume them via `var(…)`.

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

## Application updates

Built on `tauri-plugin-updater`. Each release bundle is signed at build time with a minisign
key; the matching public key is compiled into the binary, so a compromised release host
cannot push a payload the app will accept — only the private key can produce an installable
update.

- **The user decides.** `check()` only produces an offer; `UpdateStore.accept()` is the only
  path that downloads. A silent update would restart the app mid-keystroke, and the editor
  only commits its drafts on blur.
- **`UpdaterService`** (`core/updates/`) is the seam, for the same reason `IpcService` is one:
  no component or store imports `@tauri-apps/plugin-updater`, which needs a Tauri bridge that
  jsdom does not have. These are plugin commands, not ours, so they cannot go through
  `IpcContract`. The service also holds the plugin's `Update` object — a **native resource**
  with a Rust-side id that must be closed if the offer is declined, hence
  `UpdaterService.discard()`.
- **A failed check is silent; a failed install is not.** Offline, behind a proxy, or on a dev
  build whose public key is still the placeholder, `check()` fails on every launch — a banner
  there would be a daily reproach about something the user cannot act on. An install failure
  follows an explicit click, so it reaches `ErrorNotifier` and leaves the prompt open for a
  retry.
- **A manual check speaks where the startup one stays quiet.** `checkNow()`, behind the
  titlebar's About menu, reports all three outcomes — including "nothing to do", which the
  silent path has no way to express. Its failures also reach `ErrorNotifier`: the user clicked
  and is owed an answer, and the banner outlives the menu, whereas the in-menu status line
  disappears with it. Both paths share one private `runCheck({ silent })`.
- **`CheckState` is deliberately separate from `UpdateStatus`.** The latter is the install
  lifecycle that `UpdatePromptComponent.busy()` reads; the former is only what the menu has
  left to announce. Its `idle` covers both "not checked yet" and "found something" — in the
  second case the prompt is doing the talking.
- **The download does not cross the CSP.** It runs in Rust through the plugin's HTTP client,
  not in the WebView, so pointing `endpoints` at GitHub needs no widening of `connect-src`.
- `bundle.createUpdaterArtifacts` makes the bundler emit a `.sig` beside **every** bundle it
  produces, `.deb` and `.rpm` included — but the updater can only install the NSIS installer
  and the AppImage. System packages are updated by their package manager, by design, so the
  manifest step ignores their signatures instead of choking on them.
- The manifest (`latest.json`) is assembled by the `publish` job from those `.sig` files
  rather than by `tauri-action`, which only writes one when it creates the release itself —
  something the build matrix deliberately avoids. Windows is the one platform whose absence
  fails the job; a missing Linux artifact only logs a warning, so a Linux bundling problem
  cannot hold back an otherwise sound Windows release. Since the release is created as a
  **draft**, `releases/latest/download/latest.json` stays unreachable until it is published
  by hand.
- Building a bundle now requires `TAURI_SIGNING_PRIVATE_KEY` (and its password) in the
  environment. Without it `tauri build` fails, instead of shipping binaries the updater would
  later refuse.

## Tauri configuration

- `src-tauri/tauri.conf.json` wires the pipeline to Angular: `beforeDevCommand` /
  `beforeBuildCommand` run the npm scripts, `devUrl` must match the Angular dev server port
  (1420, fixed in `angular.json`), and `frontendDist` must match Angular's build output path.
- `src-tauri/capabilities/default.json` is the v2 permission manifest for the main window.
  Any new plugin or restricted API needs its permission listed there, or the call is denied
  at runtime — that is where `updater:default` and `process:allow-restart` come from.
- **`opener:allow-open-url` carries a scope**, not the bare permission: only
  `https://github.com/vmillet-dev/*` may be opened. `opener:default` would let any URL through
  the WebView's only escape hatch to the system browser. The About dialog needs the plugin
  precisely because the CSP is locked to `'self'` — a plain `<a href>` leads nowhere — and
  `AppInfoService` (`core/app-info/`) is its seam, alongside `getVersion()`. That one needs no
  permission of its own: `core:app:allow-version` already ships inside `core:default`.
- `serde_json` is a **runtime** dependency, not just a dev one: `generate_context!` embeds the
  `plugins` section of `tauri.conf.json` as JSON, and drops the section without it.
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
failure paths testable at all.

`FakeNotesRepository` deliberately **does not** reimplement filtering, grouping or tag
normalisation: those live in Rust and are tested there. Duplicating them in the double would
let a front-end spec pass against rules the real back-end does not apply. It wraps its notes
in a trivial single-section view, and a spec needing a specific shape (search results, empty
results, several sections) pins one with `setView`. `lastQuery` and `queryCount` expose what
the store asked for — which is the part of querying the front-end still owns.

That split also decides where a test belongs: assertions about _what is shown_ (which notes
match, which section they land in, how tags are cleaned) go in `src-tauri/`, while the
front-end specs cover assembling the query, pacing it, and reacting to what comes back.

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
  `vi.useFakeTimers({ toFake: ['Date'] })` with `vi.setSystemTime(...)`; for the search
  debounce, `toFake: ['setTimeout', 'clearTimeout']`. **Never** call `vi.useFakeTimers()`
  without a `toFake` list here: it also fakes `requestAnimationFrame`, which the zoneless
  scheduler relies on, and `await fixture.whenStable()` will hang forever.
  `clock.service.spec.ts` is the one exception — it asserts on the interval itself.
- Anything asserting on `document.activeElement` must attach `fixture.nativeElement` to the
  document; jsdom does not track focus for detached elements.
- Assert on text through a whitespace-normalising helper. Two templates deliberately keep
  their interpolations on a single line (and carry a `prettier-ignore`) because Angular does
  not fully collapse the whitespace a line break would introduce.
- For anything that transitively needs a store, use `provideAppTesting()` and spy on the real
  store's methods rather than re-implementing a fake store — stores have their own specs.

### Rust

`cargo test` from `src-tauri/` runs everything. `cargo clippy -- -D warnings` and
`cargo fmt --check` gate the code; `Cargo.toml` sets `unsafe_code = "forbid"` and
`deny(clippy::all)`.

The tests split along the layers, which is the point of the split:

- **`domain::`** — pure, no database, milliseconds to run. Section placement and
  exhaustiveness, local-midnight boundaries, absurd timezone offsets, tag normalisation,
  Unicode search folding, footer choice, expiry thresholds, the refusal of an unreadable
  `now`, and the JSON wire shape.
- **`storage::`** — against `open_in_memory()`, which applies the **real** migrations, so the
  tests exercise the actual schema, constraints and cascades rather than a stand-in. They pass
  timestamps explicitly instead of reading the clock, which makes assertions on `created_at` /
  `updated_at` deterministic. A `query` helper in the test module recomposes
  `fetch` + `domain::view::build` so the whole read path stays covered end to end.
- **`commands::`** — the adapter layer: that a poisoned mutex reports `storageUnavailable`
  instead of panicking a second time, and that each error variant maps to the right code and
  params.

Test names and comments are in English, like the front-end specs. `storage::notes::list`
survives only as a `#[cfg(test)]` helper — no command returns a raw list.
