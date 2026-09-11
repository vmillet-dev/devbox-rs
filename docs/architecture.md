# Architecture

How DevBox is put together, and the conventions to follow when extending it.
For build/run instructions see the [README](../README.md).

## Overview

DevBox is a Tauri v2 desktop app: an Angular single-page front-end rendered in a WebView,
and a Rust process that owns everything native (storage, and later hashing and filesystem).
The two halves talk only through Tauri's `invoke()` bridge.

Notes and spaces are complete end to end: the front-end has no in-memory dataset left, every
read and write goes through `invoke()`, and the Rust commands persist to an embedded SQLite
database. Built on top of that: a 30-day trash with undo, multiple selection and bulk actions,
corpus-wide tag management, `{{fields}}` in snippets, a quick-paste palette on a global
shortcut, attachments, and import / export / share. The planned domains (crypto, formatters)
have **no** module of their own yet: a
placeholder would ship dead code in the binary, and an empty file documenting a contract
drifts from whatever eventually gets written.

**Where the work happens.** Data processing belongs to Rust. Filtering (space, full-text,
tags, languages, quick filters), grouping into display sections, facet aggregation and tag
normalisation, and the choice of what a card's footer shows all run in `src-tauri/src/notes/`.
The front-end describes what the user asked for and renders the view it gets back — it does
not filter, sort or group. The deliberate exceptions are relative-time **formatting** (labels
must age on their own, without a round trip), the ISO ↔ `Date` conversion at the serialisation
boundary, syntax highlighting (it colours the in-flight editor draft, which is not persisted
yet — a round trip per keystroke), and plain UI concerns like keyboard shortcuts and drafts.

```
src/                Angular front-end
├── app/
│   ├── core/       cross-cutting infrastructure, one folder per subject: IPC, i18n,
│   │               errors, time, preferences, settings, updates, app-info, language,
│   │               clipboard, dialogs (native file picker), window (hide / quit /
│   │               close-to-tray), shortcuts, autostart
│   ├── features/   one folder per tool, owning its data/, model/, state/ and ui/
│   ├── layout/     the app chrome: shell, titlebar, about, preferences, error banner,
│   │               update prompt
│   └── shared/     presentation kit — a11y directives and components that inject nothing
├── assets/         static images
├── styles/         global theme (styles.scss) and SCSS partials
└── testing/        test doubles, fixtures and shared providers
src-tauri/          Rust back-end
├── src/notes/      the notes feature: model, language, view, placeholder, trash, SQL
├── src/spaces/     the spaces feature: model, SQL
├── src/attachments/ the attachments feature: model, SQL (the bytes live on disk)
├── src/transfer/   import, export and share: the exchange format and Markdown rendering
├── src/db.rs       connection, migrations, schema, stored-instant format
├── src/error.rs    the three errors and the translation between them
├── src/desktop.rs  tray and global shortcuts — native glue, not a feature
├── src/lib.rs      Tauri builder, database setup + command registration
└── capabilities/   Tauri v2 permission manifests
```

### Feature-first, not layer-first

The back-end is filed by **subject**. `notes.rs`, `spaces.rs`, `attachments.rs` and
`transfer.rs` are the features, and each owns everything about itself: its model, its SQL, and
the Tauri commands that expose it. Deleting `src/notes/` deletes the feature.

`changelog.rs` is the smallest of them, and the odd one out: it owns no table and reads no
database — the repository's `CHANGELOG.md` is baked into the binary by `include_str!` and
parsed by `changelog/model.rs`. It keeps the convention all the same, the command in the file
and the rules in the module, which is what lets the parser be tested without a Tauri runtime.

`transfer` is the one without a `store.rs`: import and export read and write **whole
libraries**, so they compose the two other stores rather than owning a table. That is also why
it is the only feature allowed a `notes::store::all` — a raw note list, which no command ever
returns to the front (see [Data access](#data-access)).

Both follow the same three-part convention:

| File                 | Holds                                                                   |
| -------------------- | ----------------------------------------------------------------------- |
| `<feature>.rs`       | the `#[tauri::command]` functions — validate, lock, delegate, translate |
| `<feature>/model.rs` | the types and the business rules, testable without opening a database   |
| `<feature>/store.rs` | the SQL, and nothing else                                               |

`notes/` carries extra modules, all of them notes-specific vocabulary: `language.rs`
(the closed `Language` enum and the heuristics that guess one from pasted content),
`view.rs` (what is asked — `NotesQuery`, `NoteFilter` — what comes back — `NotesView`,
`NoteSection` — plus the search matching and chronological placement that produce it), and
`checklist.rs` (the closed `NoteKind` enum, `ChecklistItem`, the normalisation of a list and
its Markdown rendering).

What is left at the root is what belongs to no single feature:

| Module        | Holds                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `error.rs`    | `ValidationError`, `StorageError`, and the `AppError` that crosses the bridge                  |
| `db.rs`       | the connection and its `Mutex`, `open`/`open_in_memory`, plus `db::schema` and `db::migration` |
| `db::iso8601` | the stored-instant format — millisecond-exact, because the canvas sorts on a TEXT column       |
| `desktop.rs`  | tray and global shortcuts, including the `sync_tray` command that feeds the tray its labels    |

This replaces an earlier split into three technical layers (`commands/ → domain/ ← storage/`),
which cost three files and three modules per subject and a `check-layers.sh` script in CI to
hold the direction — for a back-end whose whole job is a CRUD over two entities.

The property that split was really protecting survives on its own: `notes/model.rs`,
`notes/view.rs`, `notes/language.rs` and `spaces/model.rs` import neither Diesel nor Tauri,
so their tests run without opening a database — section placement, timezone boundaries, tag
normalisation, search folding, footer choice and expiry thresholds, in a few milliseconds
with no fixture setup.

The two features are not fully independent, and that is visible rather than hidden:
`notes/store.rs` calls `spaces::store::exists` before filing a note, and `spaces/store.rs`
moves notes out before dropping a space. The Diesel schema therefore stays shared in
`db/schema.rs` — splitting it per feature would break `allow_tables_to_appear_in_same_query!`.

Serde attributes sit on the model types rather than on a separate DTO family. At this size a
second set of types and their mapping would cost more than it protects. Each of these types
also derives `specta::Type`, which is what lets tauri-specta generate the front-end's
`bindings.ts` from them.

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
about 55, update 60, palette 65, fields form 70, enlarged image 75) is a decision, not an
implementation detail.

**80 is reserved for the two banners** in `layout/` — `StatusToastComponent` and
`ErrorBannerComponent`. They sit in the flow under the titlebar, so without it a modal's fixed,
blurred backdrop covers them; and it is precisely from a modal that they get raised ("copied
with your field values" from the editor, "could not save the note" while editing). They keep
their place in the flow and only stop being painted over. A new modal therefore goes **below**
that line, never above it.

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

`NotesStore` also owns two things that are **not** query criteria and deliberately never
reach `query_notes`:

- **The multiple selection** (`checkedIds`), derived through `checkedNotes` so that an id
  checked and then gone — note deleted, filter tightened — never reaches a bulk action.
- **The keyboard focus** (`focusedNoteId`), plus `visibleNotes`, the sections flattened in
  display order. Both the arrow keys and the Shift-range selection reason in **indexes** into
  that list, the only reference that survives a note being renamed.

Five smaller stores sit beside it, each for a screen that is not the canvas. None of them
knows `NotesStore` — the reverse dependency already exists and closing the loop would be an
injection cycle — so each returns a **boolean** and `NotesPageComponent` chains the reload:

| Store              | Owns                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| `TrashStore`       | the trash panel: open/close, list, restore, purge, empty             |
| `TagsStore`        | global tag management: list with counts, selection, rename/merge     |
| `LibraryStore`     | import, export and copy-out, each reporting through `StatusNotifier` |
| `PaletteStore`     | the quick-paste palette: its own search, highlight and copy          |
| `AttachmentsStore` | the open note's attachments, and the one preview being displayed     |

`TrashStore` and `TagsStore` load **on opening** rather than through a permanent `resource`:
neither is displayed anywhere else, and a resource would re-query on every deletion.

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

Sections are built in Rust (`src-tauri/src/notes/view.rs`) and arrive ready to render.
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
in `notes::model` and arrives as a tagged `footer` field:

| variant  | when                         | rendered as                |
| -------- | ---------------------------- | -------------------------- |
| `expiry` | the note has a deadline      | `expiryRef(at, now)`       |
| `source` | pinned, and it has a context | the first path segment     |
| `age`    | everything else              | `relativeTimeRef(at, now)` |

The dated variants carry a **date, not a label**: formatting stays on the front so "4 min ago"
keeps ageing on screen without a round trip. That is the line — the back decides _what_ to
show, the front decides _how_.

`expiringSoon` comes with it, computed against a single threshold in `notes::model`. It
previously lived only on the front (`isExpiringSoon`, 3 days) while the back separately
computed `has_expiring_notes` — two definitions of "soon" behind a hint that reads "to triage
soon". The section flag now derives from the same per-note value.

### The two kinds of note

A note is a `snippet` or a `checklist`, and `notes::checklist::NoteKind` is a closed enum for
the same reason `Language` is: the front receives a generated union, so an unhandled variant
stops compiling rather than surfacing at runtime.

A checklist has **no body**. Its items replace `content` — they are not an addition to it —
and they live in `note_items`, keyed `(note_id, position)`. That key is the whole design: an
item has no identity beyond where it sits, so every write replaces the entire list, exactly
the way `note_tags` does. Nothing addresses a single item, and nothing generates an id for
one. Reordering is therefore an ordinary write, not a shuffle of rows under a primary key
that forbids duplicates halfway through.

Three behaviours would go quietly wrong without a thought for the kind, and each is handled
where its rule already lived:

- `notes::view::matches_search` scans the item texts as well. A checklist has no `content`,
  so it would otherwise be findable only by its title.
- `transfer::model::to_markdown` renders `- [x] …` lines instead of a fenced block. An empty
  ` ```txt ` block is not something anybody pastes into a ticket.
- Language detection is skipped, at creation and on patch alike. There is no body to read,
  and a format select over a note that shows no code is a control with nothing to do — which
  is why the editor hides it too.

Both fields carry `#[serde(default)]`. `transfer::Bundle` deserialises `Note` itself, so a
required key would have made every export file written before todo lists unreadable —
`FORMAT_VERSION` stays at 1 precisely because old files still read.

Progress (`done`/`total`) is **not** on the wire. The items already travel with the note, and
a counter beside them would be the identity mapper this codebase refuses elsewhere; the card
and the editor each count in a `computed()`. That is the same line as relative-time
formatting: presenting data the front already holds is the front's job.

### A tickable card, and why it is two layers

A card is a `<button>`, and a `<button>` may not contain another — the reason the `⋯` menu
already lives in `.card-shell` rather than inside the card. Ticking a box from the canvas
needs buttons _in_ the card's body, so a checklist card is built as two layers: the card
button underneath, carrying the click surface and the keyboard focus the canvas moves around,
and a sibling `.card-items` layer over it in `pointer-events: none`, where only the item
checkboxes take pointer events back. Everything else falls through and opens the note.

This is the same trick the editor uses for its body, where the code viewer sits under the
textarea. The card button keeps a `.card-items-space` spacer so the footer does not ride up
under the list.

Ticking from the card matters more than it looks: crossing tasks off is the gesture a todo
list exists for, and routing it through the editor would put a modal between the user and a
one-click action.

### Reordering, and why not drag & drop

⚠️ **HTML5 drag & drop does not work in this WebView.** `dragDropEnabled` is Tauri's default
`true`, which is what makes a file dropped on the window reach `FileDropService` at all; with
it on, the WebView never sees `dragstart` or `drop`. Turning it off to get the DOM events
back would break attachments.

So `ChecklistEditorComponent` reorders with **pointer events** — `pointerdown`,
`setPointerCapture`, `pointermove`, `pointerup` — and the capture is what keeps a slightly
fast gesture from being lost the moment the cursor leaves the row. The call is optional
(`?.`): capture makes the gesture comfortable, it does not condition it.

`Alt+↑/↓` does the same thing from the keyboard, and it is not a bonus: the template
accessibility rules are errors here, and an interaction only the mouse can reach does not
ship. The visual preview during a drag is CSS `order`, so rows keep their place in the DOM —
and with it their focus and their caret — while only their position moves.

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

The attachment strip sits between the meta row and the body. It is fed by inputs and emits
outputs like everything else here: `AttachmentsStore` owns the state, and an effect in
`NotesPageComponent` points it at the open note. Attachments deliberately do **not** travel
inside `Note` — they have their own write cycle, and routing them through the note would mean
reloading the whole note on every add.

### The trash, and undoing a deletion

Deleting is **not** destroying. `delete_note` stamps `deleted_at` and the note leaves the
canvas; `notes::trash::RETENTION` (30 days) then decides when it really goes. Three
consequences:

- **Every read filters on `deleted_at IS NULL`** — `fetch`, `find`, both facet queries and
  the tag counts. A trashed note that resurfaced in a query would be editable without ever
  saying it is on borrowed time.
- **Purging is restricted to notes already in the trash** (`WHERE deleted_at IS NOT NULL`),
  so nothing can short-circuit the 30-day reprieve.
- **The retention is applied even if nobody opens the panel**: `lib.rs` sweeps at startup, and
  `list_trash` purges what expired before answering, so the panel never shows a note that a
  restart would erase.

`purgeAt` is **derived**, never stored: the retention can change between versions and a
deadline frozen in the database would not follow.

On the front, every deletion records the ids it took away and shows `UndoBarComponent` for
`UNDO_WINDOW_MS` (8 s).

⚠️ The banner and the record are **two different things**: `undoBanner()` is what the timer
clears, `lastDeletion()` is what `Ctrl+Z` reads, and it survives. Hiding a suggestion is not
withdrawing it — the deletion stays undoable until another one replaces it or the user
dismisses the banner by hand, which _is_ an explicit refusal.

`Ctrl+Z` is handled by the page's keydown, ahead of the modifier guard that stops every other
canvas shortcut: it is the one gesture people make without looking at the screen.

### Keyboard navigation of the canvas

The canvas is driven from the keyboard whenever the focus is neither in a field nor behind a
modal (`canvasHasFocus`, which also disables the `Ctrl+K` search shortcut). Arrows move,
`Enter` opens, `C` copies, `P` pins, `X` checks, `Delete` trashes, `Escape` clears the
selection. The keys are deliberately bare letters: they only ever fire where no typing is
happening.

**The number of columns is measured, not assumed.** It depends on the window width and each
section has its own card count, so `nextFocusIndex` (`ui/grid-navigation.util.ts`) takes the
cards' measured `top`/`left`, groups rows by `top` within a few pixels of tolerance, and picks
the nearest column in the adjacent row. Keeping it a pure function over rectangles is what
makes it testable without a DOM. Moving past an edge stops rather than wraps: wrapping in a
grid with no visible start or end makes it impossible to tell where you are.

The card is a real `<button>`, so the DOM focus follows the state through an effect —
otherwise the arrows would move an outline while the keyboard stayed behind.

### Multiple selection and bulk actions

`Ctrl`-click checks a card, `Shift`-click extends the range from the focused one, `X` toggles
it from the keyboard — the conventions of a file list, which is what the canvas becomes once
several notes are selected. `SelectionBarComponent` appears only when something is checked and
offers: move to a space, add a tag, share, move to trash.

Each action is **one command for the whole batch** (`move_notes`, `tag_notes`,
`delete_notes`), not a loop of single writes: the count comes back so a stale id in the
selection produces a partial result rather than failing the lot. Tagging **adds** without
replacing — a bulk action enriches the labelling, it does not overwrite it.

### `{{fields}}` in a snippet

A snippet like `psql -h {{host}} -p {{port=5432}}` is worth copying **filled in**. What counts
as a field is decided in `notes::placeholder` and nowhere else: the name is restricted to
`[A-Za-z0-9_-]`, so a note holding Angular template code (`{{ user.name }}`) does not turn
into a form on every copy. Values arrive parsed on `DisplayNote.placeholders`, and
`fill_placeholders` — a pure command, no database — does the substitution.

**The values are the note's, and they are kept.** `note_placeholders` stores them per note
(`(note_id, name)`, case-sensitive — `notes::placeholder::fill` tells `{{Host}}` from
`{{host}}`, where `note_tags` folds case), `set_placeholder_values` writes them, and
`placeholder::parse` merges them into the fields it finds in the text. Two consequences worth
stating: the **text** decides which fields exist, so a value whose token was renamed stays
stored but out of sight until the token comes back; and writing a value **does not touch
`updated_at`** — filling a field is not editing the note, and the canvas sorts on that column.
A field left empty is not stored (`normalize_values`): empty means "keep what the text
suggests", and storing it would freeze that answer the day the default changes.

**A value can also belong to no note at all.** The preferences panel's "Variables" page edits
`global_placeholders` (migration 7, `name` as the primary key, case-sensitive for the same
reason as `note_placeholders`): a `{{host}}` that means the same thing in every snippet is
worth saying once. Resolution order is **note value → global variable → default written in the
text**, which `notes::placeholder::resolve` builds by overlaying the non-empty typed values on
top of the globals. The text default comes last on purpose: `{{host=localhost}}` was a
suggestion noted the day the snippet was written, the variable was set for this machine.

Two things follow, and both matter:

- A global variable reaches a card as its field's **`default_value`**, never as `value`
  (`model::apply_global_defaults`). So the editor shows it in grey, as a suggestion — copying
  it into `value` would let `set_placeholder_values` freeze it in the note the day the
  variable changes. It is applied in a pass of its own, like the attachment counter, because
  `decorate` reads no database.
- `fill_placeholders` therefore **does** touch the database now, and returns a `Result`. It
  still takes no note id: the palette fills an unsaved draft as readily as a stored note.

Writing the set replaces it whole, like tags and checklist items: what is no longer sent is
what the user removed. No note is touched, `updated_at` included.

Three places offer the same single set of values. The editor carries `PlaceholderPanelComponent`,
a fold-away drawer between the metadata row and the body, mounted only for a note that has
fields — and its header is **three affordances rather than a chevron**: the whole bar is the
button (it lights up on hover), a single caret rotates instead of two glyphs swapping, and the
collapsed bar names its gesture ("Afficher") next to a summary of what it hides
(`host = db.internal · port = 5432 · +1`, capped at two). That is not decoration: with a small
caret and a monospace small-caps label — the vocabulary this app uses for inert section
headings — the bar read as a title, and nobody thought to click it; the card's ⚡ and the palette open `PlaceholderFormComponent`, seeded with the same
stored values. Both render the same rows (`PlaceholderFieldsComponent`) so the two paths cannot
drift on what an empty field means: it is a **suggestion** shown as the input's placeholder,
never a typed value.

The panel holds a local draft like the title and the body — reset on the note **id**, confirmed
on `focusout` (which bubbles, unlike `blur`) and by the editor before it closes. Its preview
toggle swaps the body for the filled text, read-only: the overlay asks (`fillPreviewRequested`),
the page fills through the back-end and hands the text back down (`filledContent`), the way
attachment previews already work. For a note with fields the toolbar's copy composes the text
**at the click** — `filledCopyRequested`, since a keystroke in the body or in a value would
make anything precomputed stale — and reports through `StatusNotifier` rather than the copy
button's tick, which would claim success before the bridge answered. "Copy as is" stays one
click away in the panel, for the note that only looks templated — the heuristic is careful,
not infallible.

### The quick-paste palette

`Ctrl+Alt+P` reveals the window and emits `devbox:palette`; `PaletteStore` opens,
searches, and on `Enter` copies the highlighted snippet and **hides the window** so the user
lands back where they were pasting.

It searches **every space and ignores the canvas filters**: when you recall a snippet you do
not remember which space you filed it in. It also keeps its own state rather than reusing
`NotesStore`, whose search would otherwise change what the canvas shows behind it.

A snippet with fields goes through the fill form first — copying `psql -h {{host}}` verbatim
gives an unusable command. `Tab` opens the note instead of copying it, which is what makes the
palette double as a "find that note" shortcut.

**It captures as much as it retrieves.** As soon as the query is non-empty, a "créer une note"
row is appended **after** the results — retrieving a snippet is the more frequent gesture and
keeps the first place, but a query that matches nothing highlights the create row by default,
which is exactly the quick-capture case. Choosing it turns what was typed into the note's
content, saved and opened straight away (no draft: there is nothing to wait for).

`PaletteStore` does not create the note itself — it does not know `NotesStore`, and the
reverse would be a cycle. `takeNewNoteContent()` hands the text over and closes; the page
chains `NotesStore.createWithContent`, the same path the clipboard capture uses.

The palette is an overlay in the main window rather than a second Tauri window: the window is
already warm behind the global shortcut, and a second one would mean a second Angular
bootstrap, its own CSP and its own lifecycle for the same result.

⚠️ It has **no focus trap**, unlike the other modals. The field keeps the focus from start to
finish and the list is walked with `aria-activedescendant`; moving the real focus onto an
option would lose the query being typed.

### Global tag management

Free-text tags drift (`auth`, `authentication`, `Auth`), and nothing else in the app lets you
recollapse them. `list_tags` returns each tag of the corpus with the number of live notes
carrying it, and one operation covers both cases: renaming onto an existing tag **is** a
merge, because the database cannot carry the same tag twice on one note. Only the button label
changes with the number of selected tags.

Two subtleties in `notes::store::retag`:

- The target is **swept along with the sources and rewritten**, which is what makes a pure
  case correction (`auth` → `Auth`) effective. `INSERT OR IGNORE` alone would change nothing:
  the primary key is `NOCASE`, so both spellings are the same row.
- `updated_at` is left alone. A global retag would otherwise float the whole corpus to the top
  of a canvas that sorts on it, for notes nobody reopened.

### Attachments

An attachment is a file **next to** a note: the database keeps a record, the bytes live in
`app_data_dir()/attachments/` under a name derived from the record's id — two screenshots both
called `capture.png` must not overwrite each other, and a name coming from outside has no
business deciding a write path.

The bytes cross the bridge only on demand, as a `data:` URI: the WebView's CSP forbids loading
a local file, and opening the `asset:` protocol would be a wide door for displaying a
screenshot. That encoding costs a third more than the file, which is why `read_attachment`
fetches **one** at a time and never the list.

**Three ways in, two ways back out.** A file arrives through the picker, through a drag-drop
onto the window (`FileDropService` — the drop is a _window_ event carrying real paths, a DOM
`drop` handler would receive nothing), or as an image pasted into the editor. It leaves
through `open_attachment` (the system's default application) or `save_attachment` (copied
where the user asks). A file you can only read the name of is not attached, it is stored.

The pasted image is the one worth explaining: the editor's `paste` handler reads only the
**type** of what was pasted and, for an image, calls `attach_clipboard_image`. The bytes never
cross the bridge — the native side reads the system clipboard, which hands it raw RGBA, and
encodes a PNG (`model::encode_png`). Sending them up to send them back down would cost two
conversions and several megabytes of JSON, and the body is a `<textarea>` that could not
display the image anyway.

The strip's inline preview is capped at 220 px so it cannot push the editor off screen, which
makes a screenshot of code unreadable — clicking it opens `ImageLightboxComponent`, bounded
only by the window. It **reuses the `data:` URI the preview already loaded**: a multi-megabyte
payload has no business crossing the bridge twice. Two consequences: the lightbox only exists
while a preview does (closing one closes the other), and the editor's Escape handler yields to
it (`imageZoomed`) since both listen on the document and the topmost layer should close first.

Ordering matters on write: the file is copied **before** the record is inserted, and the
record is rolled back with the file if the insert fails. A record without a file shows a
broken thumbnail; a file without a record is swept at the next startup
(`attachments::sweep_orphan_files`). Purging a note collects its file names **before** the
`DELETE`, since the cascade takes the records with it.

### The "Fichier" menu, and where the rest lives

The titlebar carries a **File menu** next to "À propos" — the convention of a desktop
application. It holds import, export, "copy the selection as Markdown", the preferences and
quitting.

`layout/` still knows no feature. `AppMenuRegistry` (`core/menu/`) holds the entries, and
`NotesPageComponent` **contributes** its own on construction and takes them back on
destruction. The titlebar renders whatever is registered plus its own "Quitter"; the hashing
tool will add its entries without touching that component. `disabled` is a `Signal` because
"Exporter la sélection" follows what is checked at that instant.

"Préférences…" and "Quitter" are **not** registered entries: they act on the application
itself rather than on a tool, so the menu offers them whatever is loaded.

Two things deliberately did **not** go in that menu, because they are views on the notes and
not operations on a file:

- **The trash** sits next to the quick filters in the notes topbar — it is one more way of
  looking at the notes.
- **Tag management** sits at the end of the tag rail, which is exactly what it acts on. The
  rail disappears when no tag exists, and so does the button: there is nothing to manage.

### Preferences

"Préférences…" opens `SettingsDialogComponent` (`layout/settings-dialog/`): a rail of pages on
the left, the chosen page on the right, one "Fermer" at the bottom.

**No "OK / Cancel / Apply".** Every control writes straight into `SettingsStore`, and the
interface follows on the spot. That is already the idiom everywhere else in the app — the
editor commits on blur, the locale switch flips on click — and a theme you only see after
validating is not chosen, it is guessed.

**The panel knows one page, its own.** The others come from `SettingsRegistry`
(`core/settings/`), the exact counterpart of `AppMenuRegistry`: `NotesPageComponent`
contributes "Variables" on construction and takes it back on destruction, and
`NgComponentOutlet` renders a component the panel knows nothing about. A `{{field}}` is notes
vocabulary; importing it from `layout/` would break the rule that deleting a feature folder
deletes the feature.

`SettingsStore` holds one signal per setting, backed by `PreferencesService` — one key per
setting, not one serialised object, so a setting added later cannot make a file written by the
previous version unreadable. `restore()` runs from the app initializer, after
`PreferencesService.hydrate()` and before the first render.

**Three services read those signals and push them to the native side**, rather than the store
reaching for the IPC itself — a preferences store has to stay readable outside Tauri:

| Service                  | Effect                                         | Native side                         |
| ------------------------ | ---------------------------------------------- | ----------------------------------- |
| `GlobalShortcutsService` | `set_global_shortcuts` on every change         | re-registers, returns what is taken |
| `WindowBehaviorService`  | `set_window_behavior`                          | what close and minimise do          |
| `AutostartService`       | `tauri-plugin-autostart` (`autostart:default`) | the system's own startup entry      |

Each starts from the app initializer, and each builds its `effect` with an **explicit
injector**: they are started outside a constructor, where `effect()` would have nothing to
attach to. For the same reason the initializer injects **everything before its first `await`** —
an `inject()` after one is outside the injection context, and the whole bootstrap fails with
NG0203 and a black window.

⚠️ `ShortcutBindings::defaults()` (Rust) and `DEFAULT_SHORTCUTS` (front) are a **deliberate
mirror**, commented on both sides. The native side takes the shortcuts before the front has
started: without them `Ctrl+Alt+P` would be dead for the length of the first render, which is
exactly the second one uses it from another application.

`AutostartService` reads the system **first** and aligns the preference on what it finds:
turning the entry off from the task manager has to uncheck the box, not see DevBox put it back.

**What the settings actually change**

- **Theme** — `system` / `dark` / `light`, resolved into a `data-theme` attribute on
  `<html>` (see _Theming_). `system` follows `prefers-color-scheme` live.
- **Density** — `data-density`, which swaps four spacing variables.
- **Start with the system, minimise to tray, close to tray** — the last one was DevBox's fixed
  behaviour and stays the default; both tray settings are still refused when there is no tray
  (`desktop::hides_on_close` / `hides_on_minimize`), since hiding a window nothing can call
  back is worse than closing it.
- **Quick paste** — the palette's accelerator, captured from a **keystroke** rather than typed
  (`acceleratorFromEvent` reads `KeyboardEvent.code`, so a combination set on AZERTY stays in
  the same place on QWERTY, and a combination the native parser could not read is refused
  before it is stored). And "show pinned first", the only consumer of `NotesQuery.pinnedFirst`
  that ever sends `false`.
- **Copy confirmation** — the acknowledgement lives in `ClipboardService` itself rather than in
  its five callers, four of which show nothing today: copying from the canvas with `Ctrl+C`
  said not a word. Callers with something better to say — "3 notes copied as Markdown" — speak
  after, and the banner keeps the last message.

### Help: what's new, getting started, shortcuts

The titlebar's **"À propos" menu** carries the update check, three help panels and the card
itself, separated into those three groups. They share one signal (`AboutMenuComponent.panel`)
rather than a boolean each: they sit on the same backdrop rung (55), only one is ever wanted at
a time, and four flags would allow a state where two of them are stacked and the focus trap of
the loser keeps the keyboard.

- **"Nouveautés"** renders `CHANGELOG.md`, the repository's own, **embedded in the binary** by
  `include_str!` (`src-tauri/src/changelog.rs`) and read through `app_changelog`. The Markdown
  is parsed **in Rust** (`changelog/model.rs`) into releases, categories and entries, so the
  front renders a typed structure with the components it already has: no Markdown renderer to
  pull in, no `innerHTML`, nothing for the CSP to forbid. The grammar is deliberately thin —
  `## ` a release, `### ` a category, `- ` an entry, an indented line continues the one above —
  and the file is written to match it; a shipped file that no longer parses fails a test rather
  than emptying the panel in silence. The changelog is **not translated**, on purpose and like
  the release notes the updater hands over: one changelog, written once, rather than two that
  drift apart. The panel marks the release the running binary is, and its footer opens the
  repository's releases page through the `opener` plugin.
- **"Prise en main"** is nine chapters of prose, keyed by translation
  (`gettingStarted.chapters.<id>`). The list of chapters lives in the component rather than in a
  registry, unlike the menu entries and the shortcut groups, because a chapter carries **no
  code**: nothing to run, nothing a feature has to be loaded to provide, so `layout/` imports
  nothing from a feature by naming them. The bodies are handed the live key bindings as
  interpolation parameters — a guide quoting the combination that shipped would be wrong for
  anyone who changed it.
- **"Raccourcis clavier"** is a read-only sheet. Read-only because the one shortcut that can be
  changed is changed in the preferences, and a second editor for it would be a second place to
  keep in step.

`ShortcutsRegistry` (`core/shortcuts/`) is the third instance of the contribution pattern, after
`AppMenuRegistry` and `SettingsRegistry`: the arrows of the canvas, `X` to check a card and
`Alt+↑` to reorder a checklist item belong to the notes, and listing them from `layout/` would
leave a sheet full of keys that do nothing the day the hashing tool is alone on screen.
`NotesPageComponent` registers three groups on construction and takes them back on destruction.

The **global** group is the exception and is built by the dialog itself: those three
combinations are the application's, they work with the window closed, and the quick-paste one
follows a preference — the sheet reads `SettingsStore` so it shows the key that is really bound
rather than the one that shipped. A shortcut is spelled as one `<kbd>` per key
(`acceleratorKeys`), the `+` drawn between the caps and `aria-hidden`: inside a cap it reads as
a key to look for on the keyboard. What is not a key press — `Ctrl` + click to check a card — is
said in the label rather than drawn as a cap.

The three panels share their frame through mixins in `src/styles/_mixins.scss`
(`help-panel`, `help-header`, `help-body`, `help-actions`, `key-cap`) rather than through a
common component: a component's SCSS is out of reach of its neighbours, and three panels that do
not look alike would read as three unrelated windows.

### The first launch

A brand-new installation opens on **sample notes**, in a space of their own
(`SampleNotesService`, `features/notes/state/`). This is not decoration: a virgin database has
no space, and creating a note with nowhere to file it is refused on purpose — so without them
the first screen is empty, silent, and offers a "+ Nouvelle note" button that does nothing.

Four notes, one feature each: a pinned welcome note (so the first screen is not an empty
"pinned" heading), a shell snippet carrying `{{fields}}`, a checklist, and a code snippet with a
deadline — which is what lights the ⏳ badge and gives the "à trier" filter something to find.
They are ordinary notes: editing or trashing them is the point, and the written guide behind
"Prise en main" is what survives the day they go.

**The content comes from the front end**, not from a seed in Rust, for the reason no
user-facing string ever comes out of the back end: it would ship French into an English
interface. It also means the samples arrive in the language the application starts in. The two
snippet bodies are the exception and are hard-coded in the service — they are _code_, so they
are not translated, and they could not be: Transloco reads `{{name}}` as an interpolation and
would replace a snippet's fields with empty strings on the way out.

⚠️ **Two guards decide a first launch, not one.** A preference marker
(`devbox.notes.samplesSeeded`) alone would re-seed anyone whose preferences file went missing;
"no space at all" alone would re-seed the day the last space disappears. Together they only ever
match a database that has never been written to. The marker is written **before** the notes, so
a write that fails halfway leaves an incomplete set rather than a second full set on the next
launch, and an installation that predates the samples is marked as skipped so the check stops
running on every launch. A failure is silent: the canvas reports its own, and a second banner
about samples nobody asked for would only add noise.

### Import, export and copying out

- **Export** writes a JSON bundle (`transfer::model::Bundle`: a version, an instant, the
  spaces cited and the notes), for everything, one space, or the current selection. The format
  reuses the domain types rather than duplicating them, so a field added to `Note` is exported
  without anyone thinking about it. Only the spaces actually cited travel: exporting one space
  should not recreate a whole tree on the other side.
- **Import merges, it never replaces.** Spaces are matched by name, case-insensitively, and a
  note whose id is already taken is counted as skipped rather than overwritten — so the same
  file can be imported twice without duplicating anything. A bundle from a newer format
  version is refused outright rather than half-read.
- **Copying out stops at the clipboard.** `share_notes` renders the selection as Markdown
  (heading, space, context, tags, then a fenced block). The fence is longer than the longest
  run of backticks in the content, otherwise a note that already contains a Markdown block
  would cut its own in half. The menu entry names the format — "Copier la sélection en
  Markdown" — because a format nobody asked for is a surprise, not a feature.

⚠️ **Every one of these reports, including when it changed nothing.** Exporting then
re-importing at once is the first thing anyone tries, and it legitimately imports zero notes:
every id is already there. Without a message that outcome is indistinguishable from a
failure, so `LibraryStore` pushes a distinct `file.importedNothing` for it, and an export
names the file it wrote. The report goes to `StatusNotifier` (`core/notifications/`), rendered
under the titlebar by `StatusToastComponent` — not inside the menu, which closes on the click
and which a native file dialog covers anyway.

`transfer::collect` and `transfer::merge` take a `&mut SqliteConnection` rather than living
inside the commands, which is what makes the round trip testable (`tests/transfer.rs`) without
a Tauri runtime.

The file itself is written and read **in Rust**: the serialisation is the domain's, and
sending it across the bridge to be reassembled in TypeScript would mean a second format to
keep in step. The front-end only picks a path, through `FileDialogService`.

### Creating a note writes nothing

Opening the editor on "+ Nouvelle note" produces a **local draft** (`DRAFT_ID`), not a row: a
blank note per opening turns the canvas into a pile of things to tidy up. The draft is
persisted on the first change that makes it worth keeping — a title, a body, a tag, a pin, a
deadline (`isWorthSaving`) — and closing it untouched simply drops it.

⚠️ `draftMaterialisedAs` is not optional. Closing the editor commits the title **then** the
content with no change detection in between, so the second call still carries `DRAFT_ID` while
the note already exists; `resolve()` redirects it. Without that, the second commit would write
into nothing.

Attaching a file needs a real row, so `materialiseDraft()` saves the draft first — a note you
attach a file to is not empty either.

### Data access

Stores never talk to a data source directly. They inject `NotesRepository` /
`SpacesRepository` — ordinary `providedIn: 'root'` classes, not an interface behind an
`InjectionToken`. There is one implementation and there has only ever been one; the triad
described a variation that does not exist, and `app.config.ts` binds nothing for them.

Substituting them is still a one-liner: `provideAppTesting()` overrides each class with
`{ provide: NotesRepository, useValue: fake }`, exactly as it already does for
`UpdaterService` and `AppInfoService`. What the interface really bought was the _compile-time
check on the doubles_, and the fakes keep it with
`implements Pick<NotesRepository, keyof NotesRepository>`: `keyof` on a class type yields only
its public members, which both drops the private `ipc` (nominal, hence unimplementable) and
keeps the method list in sync by construction. Rename a method on the real class and
`src/testing/` fails to compile.

The notes contract is `query` / `create` / `update` / `delete`, plus the batch and trash
operations (`deleteMany`, `restore`, `loadTrash`, `purge`, `emptyTrash`, `moveMany`,
`tagMany`), the corpus-wide tag operations (`loadTags`, `renameTag`, `mergeTags`,
`deleteTag`) and `fillPlaceholders`. Spaces expose `loadAll` / `create` / `rename` / `delete`.
`AttachmentsRepository` covers `loadFor` / `attach` / `read` / `delete`, and
`TransferRepository` covers `export` / `import` / `share`.

There is deliberately **no method returning the raw list of notes** — offering one would invite
a caller to filter it again. That holds even for export: `export_notes` returns a _count_, and
the note list it assembled never leaves Rust.

`SpacesRepository.delete` takes a refuge (`delete(id, targetSpaceId)`) rather than an id
alone: a one-argument signature would have made data loss the default, since the schema
cascades. Moving a single note needs no dedicated method — `spaceId` is part of `NotePatch`,
and `NotesStore.moveNote` is a thin wrapper over the ordinary update path.

`SpacesStore.deleteSpace` returns a boolean and does **not** reload the notes: it does not
know `NotesStore` (the reverse dependency already exists, and closing the loop would be an
injection cycle). `NotesPageComponent` chains the reload, which matters when the current
query does not mention the deleted space and would otherwise show nothing new.

Keep this seam intact: no component or store calls a command, the repositories do.

## IPC boundary (Angular ↔ Rust)

**The boundary is generated, not written.** `src/app/core/ipc/bindings.ts` is produced by
[tauri-specta](https://docs.rs/tauri-specta) from the Rust signatures: one typed function per
command, plus a TypeScript type for every struct and enum that crosses the bridge. It is
committed — the front-end does not compile without it — and regenerated by

- `npm run tauri dev`, which rewrites it at every launch (`export_bindings()` in `lib.rs`,
  behind `debug_assertions`), or
- `npm run bindings`, which runs the `export-bindings` binary alone when a Rust signature
  changed and starting the whole app is not worth it.

It deliberately is **not** a `#[test]`: on Windows the test executable lives in
`target/debug/deps/`, where the `WebView2Loader.dll` that `tauri-build` drops is absent, and
merely linking `Builder::export` there stops the binary from starting at all.

This replaces the hand-written `IpcContract` table and the `tauri::generate_handler![…]`
list, which were two mirrors of the same thing kept in step by review. `collect_commands![…]`
in `lib.rs` is now the single list: it both registers the commands with Tauri and decides
what `bindings.ts` contains. Tauri matches arguments **by name** and renames them to
camelCase; nobody spells `targetSpaceId` by hand any more.

Only `features/notes/data/` and `core/ipc/` import `bindings.ts`. Everything else keeps
importing the DTO aliases from `note.dto.ts`, so the generated file stays behind the same
boundary the hand-written types were behind.

### Calling a command

`commands.queryNotes(query)` returns a **discriminated result**, not a promise that rejects:
`{ status: 'ok', data }` or `{ status: 'error', error }`. Repositories pass it through
`unwrap()` (`core/ipc/ipc.error.ts`), which returns the data or throws an `IpcError`. Stores
and components therefore keep the `try`/`catch` they already had, and `ErrorNotifier` stays
the one place that branches on a cause.

### Error contract

Commands return `Result<T, AppError>`, never `Result<T, String>`. An `AppError`
(`src-tauri/src/error.rs`) carries a stable **code**, its interpolation **params**
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

`IpcErrorCode` is a plain alias of the **generated** `ErrorCode` union, so it is no longer a
mirror at all — adding a Rust variant makes it appear on the front at the next generation.
Two tables then fail to compile until the new case is handled: `CODE_KEYS`, typed
`Record<IpcErrorCode, string | null>`, and `IPC_ERROR_CODES` in `ipc.error.ts`.

That second table is a runtime guard, and it still earns its place: `bindings.ts` _declares_
the error branch as an `AppError`, but Tauri itself rejects with a plain **string** for an
unknown command or an argument that fails to deserialise, and that value lands in the same
branch. `IpcError.code` is `null` in exactly those cases, and the message falls back to the
raw cause so the failure stays readable.

`ErrorCode` has no variant for a too-recent schema: that failure is only produced by the
migration during Tauri's `setup()`, where it aborts startup. No command can return it, so
giving it a code would advertise a case the front can never handle.

Three codes exist for what happens **outside** the database: `attachmentNotFound`,
`fileAccess` (reading, copying or writing a file — attachments, export and import all land
there) and `importFormat` (a file offered as a bundle that is not one, or one written by a
newer version). They are codes rather than a generic storage failure because each has a
different thing to tell the user, and only `importFormat` means "choose another file".

### Serialisation contract

**The wire types are generated; the conversion is not.** `model/` is the vocabulary the
application reasons in — what stores, components and templates manipulate; `data/` is the
boundary — the shape that crosses the bridge, the repository that crosses it, and the
conversion between the two. What used to be hand-written wire interfaces are now aliases of
generated types (`export type NoteDto = DisplayNote`), kept in `note.dto.ts` so that callers
import the boundary vocabulary from the boundary, not from `bindings.ts`.

Where the two shapes coincide, the model type travels as it is: a space still has no mapper.
An identity mapper is not symmetry, it is one more name for one type.

What generation does **not** remove, and why `features/notes/data/note.dto.ts` is still the
biggest file in `data/`:

- **JSON has no date type.** Rust types every timestamp as a `String`, so the bindings do too.
  The mapper parses it into a `Date` and throws a `ContractError` on an unparseable value,
  rather than letting an `Invalid Date` propagate and resurface as `NaN` in a relative-time
  label. The reverse direction (`toIsoString`) guards the same way.
- **The front no longer narrows the language.** It was a free `String` in the model;
  the front restricts it to a `LanguageTag`.
- **A patch omits what it does not touch.** The Rust fields carry `#[specta(optional)]`, so
  the generated `NotePatch` has optional keys and `toNotePatchDto` can copy field by field —
  an explicit `undefined` would serialise to `null` and overwrite the stored value.

The serde attributes are still load-bearing (`rename_all = "camelCase"` on the structs,
`tag = "kind"` on the data-carrying enums), but they no longer need to be mirrored by hand:
specta reads them and the generated types follow. The tests in `notes/model.rs` that pin the
JSON shape are now a second line of defence rather than the only one.

An unknown `language` value degrades to `txt` instead of failing the load, and an unknown
entry in `availableLanguages` is dropped from the rail: a newer backend may know a language
this front-end build does not — and since Rust types it as a plain string, the bindings cannot
rule it out. A section key needs no such guard any more: `NoteSectionKey` is generated, so a
variant added in Rust breaks the assignment at compile time instead of throwing at runtime.

The known list is `notes/language.rs` (`Language`), aliased by `core/language/language.model.ts`
(`LanguageTag` + `LANGUAGE_LABELS`). Adding a language means editing both, plus a `.lang-*`
rule in `language-badge.component.scss` and, if it should be coloured, an entry in `GRAMMARS`.
Nothing compares the two lists, so a drift only surfaces at runtime as a fallback to `txt`.

**The language is detected, not asked for.** `notes/language.rs` reads the content and returns
one of `LANGUAGES`; without it every note is born `txt` and the format rail only serves people
who remember to touch the select. Three things keep it honest:

- `txt` doubles as **"nothing chosen"**, and detection runs on exactly two moments, both of
  which are a note acquiring its first content:
  - `with_detected_language` on a draft that reaches `create_note` as `txt` — the capture
    shortcut, which pastes and creates in one go;
  - `language_after_patch` when a patch gives a **still-empty** note its content — the ordinary
    "+ New note, then paste", where creation sees no content at all. Applied from
    `notes::store::update`, which calls into the model for the rule the same way it calls
    `notes::model::normalize_tags`.
- It **never replays afterwards**. Once a note has content, or carries a language other than
  `txt`, or the patch sets a language itself, nothing is guessed: re-detecting on every write
  would take the select back from the user, and there would be no way to overrule a bad guess.
- The heuristics are cheap and **allowed to be wrong**: the result is a starting value the
  editor can change. A miss costs one click.
- Order runs from the most discriminating signal to the vaguest (a wrapping brace beats a
  `key: value`), so each new rule goes in at the position its confidence earns.
- The editor commits a **paste** immediately rather than on blur (`onBodyInput` tests
  `inputType === 'insertFromPaste'`). The language is only known once the content is persisted,
  so waiting for the blur would leave the badge on TXT — which reads as a failed detection.
  Plain typing stays deferred: that is what avoids one round trip per character.

### Rules

- A new command needs **one** registration: `collect_commands![…]` in `src-tauri/src/lib.rs`.
  Annotate it `#[tauri::command]` **and** `#[specta::specta]`, then regenerate — an unannotated
  function will not compile inside `collect_commands!`.
- Every type crossing the bridge must derive `specta::Type` alongside its serde derives.
- Specta refuses to export `usize`, `isize` and the 64-bit-and-wider integers, since JSON
  cannot carry them without precision loss. Use a sized type the wire can hold — `NotesView.matched`
  is a `u32` for exactly this reason.
- Commands are **adapters only**: validate the input, lock the shared connection, delegate,
  translate the error. A command that grows is a sign a rule was written in the wrong place.
- `bindings.ts` is excluded from ESLint and Prettier: its shape belongs to the generator, and
  reformatting it would make every regeneration a diff.

### The downward direction: events

`bindings.ts` covers the front asking the back a question. The reverse — the back telling the
front something happened — goes through **`AppEventsService`** (`core/ipc/app-events.service.ts`),
which wraps `listen` from `@tauri-apps/api/event`. tauri-specta can generate typed events too
(`collect_events![…]`); the desktop events are declared in `desktop.rs` rather than as command
payloads, so they are not part of the generated surface today.

Today it carries the desktop integration, which lives in `src-tauri/src/desktop.rs` — global
shortcuts and the system tray. It is native glue rather than a feature, so it sits beside
`notes/` and `spaces/` rather than inside either. None of it needs a
capability: capabilities gate the API the **WebView** calls, not what the native side does on
its own.

Two producers, **the same three events**, so the front wires the actions once:

- `Ctrl+Alt+V` / `Ctrl+Alt+N` / `Ctrl+Alt+P`, registered at startup;
- the tray menu's "new note", "paste from clipboard" and "quick paste" items.

Each reveals the window and emits `devbox:capture`, `devbox:new-note` or `devbox:palette`;
`NotesPageComponent` listens, reads the clipboard, creates the note or opens the palette.

⚠️ **A global shortcut is first-come, first-served across the whole machine**, and the loser
gets no error — the key simply does nothing. `Ctrl+Alt+Space` was the palette's first choice
and lost it to a widely installed application, which is why it is now `Ctrl+Alt+P`. Losing one
is still possible, so `set_global_shortcuts` **returns** what it could not take and the front
says so. A log line is not an interface. The same command re-registers the three from scratch
whenever the preference changes — everything is released first, or an abandoned combination
would keep answering.

- **Rust does not create the note.** Keeping creation on the front means one creation path
  (`create_note`), so a captured note gets language detection without a second implementation,
  and the adapter stays thin.
- The topic strings are a **mirror**: `mod events` in `lib.rs` and `AppEventTopic` in the
  service. Nothing checks them against each other, and a typo produces a subscription that is
  silently inert rather than an error.
- A shortcut already taken by another application is **logged and ignored**, never fatal:
  DevBox has to start without it.
- `AppEventsService.on()` returns an unsubscribe immediately although the subscription only
  lands a tick later; a component destroyed in between would otherwise stay subscribed for the
  whole session.

### System tray

DevBox stays resident in the notification area, and **the window's close button only hides it**
— quitting goes through the tray menu. An app made to be one shortcut away would be pointless
if closing it killed the shortcut. It is a preference now (see _Preferences_), still on by
default; minimising to the tray is the same idea, off by default. Tauri emits nothing for
"minimised", so `lib.rs` watches `Resized` and asks the window where it stands.

- **The front creates the tray, not the native startup.** `TrayService` (`core/tray/`) pushes
  the menu labels through `sync_tray`, and Rust holds **no user-visible string at all**: the
  interface language is a front-end preference, and a translation table in Rust would be a
  second source to keep in step. The subscription re-emits on every language change, so the
  menu re-translates itself.
- **Closing only hides when a tray exists** (`desktop::tray_exists`). Without that guard, a
  desktop with no notification area would leave a hidden window and a process nothing could
  bring back.
- `sync_tray` is the one command that returns no `Result`. A missing tray is not a failure the
  front can act on, and giving it an `ErrorCode` would add a branch no UI would ever render —
  it is logged natively, like an unavailable global shortcut.

The commands, grouped by the feature that owns them:

| Feature       | Commands                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `notes`       | `query_notes`, `create_note`, `update_note`, `delete_note`, `delete_notes`, `restore_notes`, `list_trash`, `purge_notes`, `empty_trash`, `move_notes`, `tag_notes`, `list_tags`, `rename_tag`, `merge_tags`, `delete_tag`, `fill_placeholders`, `set_placeholder_values` |
| `spaces`      | `list_spaces`, `create_space`, `rename_space`, `delete_space`                                                                                                                                                                                                            |
| `attachments` | `attach_file`, `attach_clipboard_image`, `list_attachments`, `read_attachment`, `open_attachment`, `save_attachment`, `delete_attachment`                                                                                                                                |
| `transfer`    | `export_notes`, `export_selection`, `import_notes`, `share_notes`                                                                                                                                                                                                        |
| `desktop`     | `sync_tray`, `unavailable_shortcuts`                                                                                                                                                                                                                                     |

The guarantees the front-end relies on (persisted value returned, `Err` on an unknown id,
"absent field means unchanged" for patches) are implemented in each feature, and tested there.
The batch commands return a **count** rather than a `Result` per note: a selection can hold an
id that has gone stale, and failing the whole batch for one of them would be worse than a
partial result.

`fill_placeholders` is the one command with no `State<Db>`: it is a pure function, so the
palette can fill an unsaved draft as easily as the note it just opened.

`delete_space` takes a **refuge** (`targetSpaceId`) and is the one command whose argument is
multi-word, so it is the first to actually exercise Tauri's camelCase renaming. The refuge is
not optional: `notes.space_id` carries an `ON DELETE CASCADE`, so a bare delete would take
the notes with it. `spaces::store::delete` moves them and drops the space in one
transaction, in that order, and deliberately leaves `updated_at` alone — the canvas orders on
that column, and refreshing it would float the whole absorbed space to the top as if every
note had just been edited. A space cannot be its own refuge (`spaces::model::validate_move_target`);
the cascade would take the notes back out one statement after the move.

`query_notes` takes a `NotesQuery` (space, search, quick filter, tags, languages, `now`,
`tzOffsetMinutes`) and returns a `NotesView` (sections, `availableTags`, `availableLanguages`,
`isFiltering`, `matched`). The pair `isFiltering` + `matched` is what lets the UI distinguish
"no results" from "this space is empty" without recomputing anything. Its two steps are
visible in the command body: `notes::store::fetch` runs the indexed SQL, `notes::view::build`
applies the rules to what came back. `fetch` returns the notes plus a `Facets { tags,
languages }` — the two rails ask the same question of two columns, and passing two bare
`Vec<String>` side by side would be indistinguishable at the call site.

**Tags and languages are both facet rails**, and behave identically: union semantics (a note
passes if it carries _at least one_ of the selected values), facets scoped to the space rather
than to the current filter, and a selection counts as `is_filtering` — which collapses the
canvas into a single flat `results` section. The quick filters (pinned / untriaged) do not:
they narrow a view that stays chronological. One asymmetry: selected tags go through
`notes::model::normalize_tags` before hitting SQL, selected languages do not — a language is picked
from a closed list, not typed, and `notes::language` compares it exactly.

The serialisation contract is pinned by tests in `notes/model.rs`, `notes/view.rs` and
`spaces/model.rs` rather than left to review: they assert the emitted
JSON keys are camelCase, that a lifecycle serialises to `{"kind":"expires","at":…}`, that a
section key serialises to `"older"`, that a decorated note serialises **flat**, and that an
error code serialises to `"noteNotFound"`. A serde attribute deleted by accident fails
`cargo test` instead of silently breaking the UI.

### Input validation

The back validates what the front already constrains, because a rule held only by a form is
not held at all. `error.rs` defines a `ValidationError` carrying the offending
`field`; commands call `draft.validate()` / `draft.validated_name()` before touching the
connection, and `AppError` turns the refusal into `invalidInput` with `{{field}}`.

What is checked: `language` against the known list (an arbitrary value would be unreadable by
any front build), a space name trimmed and non-empty (`COLLATE NOCASE` folds case but not
whitespace, so `"Perso "` would otherwise sit beside `"Perso"`, identical on screen), and
`NotesQuery.now` as a parseable instant — falling back to the server clock would silently
re-cut every section on a different day.

## Persistence (Rust)

Storage is **SQLite**, queried through **Diesel** and embedded via `libsqlite3-sys` with the
`bundled` feature — SQLite is compiled from source and statically linked, so nothing has to be
installed or shipped alongside the executable. The database file lives in Tauri's
`app_data_dir()`.

- **The store is plain functions.** `notes::store` and `spaces::store` take a
  `&mut SqliteConnection`; the `#[tauri::command]`s sit on top. That is what makes persistence
  testable against `SqliteConnection::establish(":memory:")` without launching Tauri. A store
  holds **no business rule** — it reads and writes the model defined in its sibling
  `model.rs`, which it depends on.
- **`db/schema.rs` is the typed mirror of the schema**, written by hand rather than
  produced by `diesel print-schema`, which would make `cargo check` depend on an up-to-date
  database sitting outside the repository. What it deliberately does not model — `CHECK`
  constraints, `ON DELETE CASCADE`, and the `NOCASE` collation on `note_tags.tag` — stays in
  the migration SQL. Diesel obeys those; it does not own them.
- **Concurrency.** A `SqliteConnection` is not `Sync`, and Diesel takes it exclusively for
  every query, reads included. A single connection is shared as `tauri::State<Db>`
  (`Db = Mutex<SqliteConnection>`), registered with `.manage()` in `lib.rs` — never a global.
  Overlapping commands serialise on that mutex, as they already did; the `&mut` changes the
  signatures, not the concurrency.
- **Migrations.** They live as SQL files in `src-tauri/migrations/`, are compiled into the
  binary by `embed_migrations!`, and are tracked in the `__diesel_schema_migrations` table.
  Evolving the model means adding a `YYYY-MM-DD-HHMMSS_name/` directory — never editing a
  shipped migration, it has already run on user machines. Each migration is atomic. A database
  carrying a migration this binary does not know is refused rather than misread.
- **The legacy `PRAGMA user_version` history is adopted, not replayed.** The schema used to be
  versioned by that pragma (values 1 to 3). `db::migration::adopt_legacy_history` marks the matching
  embedded migrations as already applied and zeroes the pragma, so an existing install neither
  re-runs `CREATE TABLE spaces` nor keeps a second, drifting source of truth. A pre-Diesel
  binary reopening such a database now fails loudly at startup instead of writing into a schema
  it believes it understands.
- **A checklist's items are a child table, not a serialised column.** `note_items` is keyed
  `(note_id, position)` and written by wiping the note's rows and re-inserting them in order —
  the same shape as `note_tags`, for the same reason. It is _not_ read back after writing, and
  that asymmetry with tags is deliberate: `position` orders numerically, which the insertion
  order reproduces exactly, whereas `note_tags.tag` is `COLLATE NOCASE` and only a read gives
  its order. `notes.kind` carries no `CHECK`, following `language` rather than `lifecycle_kind`:
  the list of kinds lives in the domain and can move between versions. Its `DEFAULT 'snippet'`
  is not a convenience either — SQLite refuses an `ADD COLUMN NOT NULL` without one, and it is
  what gives every note already in the database its value.
- **Filled `{{fields}}` are a child table too.** `note_placeholders` is keyed `(note_id, name)`
  and rewritten whole, like `note_tags` and `note_items` — what is no longer sent is what the
  user cleared, and a partial write would leave an emptied value still filling the text. Its
  key is **case-sensitive**, unlike `note_tags.tag`: `notes::placeholder` distinguishes
  `{{Host}}` from `{{host}}` in the text, and folding here would fill one with the other's value.
- **Schema choices that made filtering movable to the back-end.** `lifecycle` is split into
  `lifecycle_kind` + `lifecycle_expires_at` columns rather than stored as JSON, and tags live
  in their own `note_tags` table rather than in a serialised column. Both exist so that
  filtering by tag, or querying what expires before a date, is a `WHERE` clause instead of a
  full re-read — which is why `query_notes` needed no migration. `PRAGMA foreign_keys` is set
  per connection, which is what makes the `ON DELETE CASCADE` on notes and tags actually fire.
- **Ordering is the back-end's call.** `notes::store::fetch` orders by `updated_at DESC, id`;
  the front-end preserves the order it receives, so this one query decides what the user sees
  first. Note the deliberate asymmetry: the order is by `updated_at` while sections group by
  `created_at`. The section answers "when was this note born", the order within it answers
  "which did I touch last", so an old note reopened today tops the "older" section.
- **Querying splits the work by what each tool does well.** SQL handles what it indexes —
  space, pin state, lifecycle, language, and tag membership through a `note_tags` subquery
  (`notes::id.eq_any(...)`). The conditional criteria are assembled on a Diesel `into_boxed()`
  query, which is what replaced hand-numbered `?N` placeholders and their bound-parameter
  bookkeeping.
  Full-text
  matching is done **in Rust** (`notes::view`), because SQLite's `LOWER()` only folds ASCII
  without ICU, so `Étape` would not match `étape`. Grouping is `notes::view`, which
  touches no connection and is therefore testable without a database.
- **Tag normalisation lives in `notes::model::normalize_tags`, and only there.** Trimming,
  stripping leading `#`, dropping blanks and collapsing case-insensitive duplicates (first
  spelling wins) all happen on write, so the front sends what the user typed. The returned
  tags are sorted to match what a read gives back — otherwise a note's tags would reorder
  themselves on the next reload.
- **Tag case folds at the storage level too.** `note_tags.tag` is `COLLATE NOCASE`
  (the `fold_tag_case` migration). Without it `normalize` only deduplicated _within_ one note: `Urgent` and
  `urgent` carried by two different notes produced two facets in the rail, of which
  `tag IN (…)` — running in BINARY — matched only one, while the text search confused them.
  Three behaviours for one concept.
- **`notes.language` is indexed** (the `index_language` migration), since it became a filtering facet: both
  `language IN (…)` and the `SELECT DISTINCT language` that feeds the rail would otherwise
  scan the table on every query. No `CHECK` constraint on the column, though — the list of
  known languages lives in `notes::language` and moves between versions; freezing it in the
  schema would mean a migration per addition.
- **Timestamps are injected, not read.** `notes::store` takes `now` as a parameter and the
  command passes `Utc::now()` — the same reason `ClockService` exists on the front.
  Millisecond precision is deliberate: two notes saved within one second would otherwise be
  impossible to order.
- **Deletion is a column, not a `DELETE`.** `notes.deleted_at` (the `trash_and_attachments`
  migration) is `NULL` for a live note, which lets the index be partial and every read filter
  on `deleted_at IS NULL`. See [The trash](#the-trash-and-undoing-a-deletion) for what that
  costs and buys.
- **Attachment bytes are not in the database.** The `attachments` table holds a record; the
  file sits in `app_data_dir()/attachments/`. A base growing by 10 MB per screenshot would
  make every note read slower, for data no query ever looks inside.
- **`updated_at` is not touched by operations the user did not aim at a note.** Deleting a
  space moves its notes, a global retag rewrites their tags, restoring pulls one back out of
  the trash, filling a `{{field}}` records a value — none of the four refreshes it. The canvas
  sorts on that column, and touching it would float notes nobody reopened to the top. It is
  also why the field values are a command of their own rather than a `NotePatch` field: the
  patch path exists to refresh that column.

## Cross-cutting services

- **`ClockService`** (`core/time/`) exposes `now` as a signal ticking every 30 s. Relative
  time computed with `new Date()` inside a `computed()` freezes: the computed depends on no
  signal representing time, so it never re-evaluates and a card shows "4 min ago" forever.
  Injecting `now()` makes those computeds both pure and self-refreshing.
- **`PreferencesService`** (`core/preferences/`) stores UI preferences in a real file through
  `tauri-plugin-store` (`preferences.json` in `app_config_dir()`), readable from Rust and
  immune to a WebView cache wipe — unlike the `localStorage` it replaced. Two consumers:
  `LocaleService`, and the editor overlay's two display toggles — fullscreen
  (`devbox.editorFullscreen`) and the fields drawer (`devbox.editorFieldsPanel`, open by
  default: a drawer folded on first sight hides the feature from whoever does not know it yet).
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
- **`SettingsStore`** (`core/settings/`) is the application's own settings, on top of
  `PreferencesService`. It writes as it is read — there is no draft to validate — and it talks
  to nobody: `GlobalShortcutsService`, `WindowBehaviorService` and `AutostartService` read its
  signals and carry each change to the native side. See _Preferences_.
- **`ErrorNotifier` + `AppErrorHandler`** (`core/errors/`) surface failures on screen through
  `ErrorBannerComponent`. On a desktop app the console is not an interface: an uncaught
  exception or a failed write has to be visible, or the app just looks unresponsive.
- **`ClipboardService`** (`core/clipboard/`) is the system clipboard. The CSP locks the WebView
  to `'self'` and `navigator.clipboard` is unusable there, so everything goes through
  `tauri-plugin-clipboard-manager` (permissions `clipboard-manager:allow-read-text` and
  `allow-write-text`). Same `CLIPBOARD_ADAPTER` token and same degradation as
  `PreferencesService`: outside Tauri the plugin rejects, and the service reports a `false`
  rather than throwing — a copy that failed only has a visual acknowledgement to withhold.
  It is in `core/` by the usual test: a hashing tool would inject it verbatim.
- **`FileDialogService`** (`core/dialogs/`) is the native file picker, behind
  `tauri-plugin-dialog` (permissions `dialog:allow-open` and `dialog:allow-save`). Same
  `FILE_DIALOG_ADAPTER` token and same degradation as above, with one addition: `null` covers
  both a cancelled dialog **and** an unavailable plugin. An exception would force every caller
  to tell two non-choices apart, and there is nothing to open either way. It also flattens the
  plugin's `string | string[]` union, which stays a union even with `multiple: false`.
- **`AppWindowService`** (`core/window/`) hides the window and quits the app
  (`core:window:allow-hide`, `process:allow-exit`). The two are and stay distinct: the window's
  close button **hides** (`lib.rs` intercepts `CloseRequested` while there is a tray), the
  palette hides after copying, and `quit()` is the only path that really ends the process. The
  adapter is substituted in **every** spec — a real `exit()` would take the test runner down
  with the application.

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
- Nothing user-visible is hard-coded in the Rust back-end. A new note is created with an
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

**Light theme.** `:root` stays the dark palette and `:root[data-theme='light']` redefines the
colours only — fonts, shadows and spacing are shared. Dark stays the base on purpose: the
preference lives in a file nothing can read before Angular has booted, so any other order would
flash white at launch. `color-scheme` switches with the palette, which is what repaints the
native `<select>`s, scrollbars and autofill. The accent is a **separate hue** in light mode:
the dark `--amber` (#e8a33d) falls to 2:1 on white, and `--amber-ink` — the text laid on a
solid amber button — flips with it. The syntax-highlighting theme needs nothing: it only ever
consumed these variables.

**Density.** `:root[data-density='compact']` tightens four variables — `--space-card`,
`--space-grid`, `--space-section`, `--space-canvas` — and nothing else. Typography is
untouched: shrinking the text would be a zoom, not a density. Four named gaps rather than a
global factor, because these four are what decide how many cards fit on screen; everywhere else
the spacing stays hard-coded, since compressing all of it would cost legibility without buying
a line.

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
- **`UpdaterService`** (`core/updates/`) is the seam, for the same reason the repositories are
  one: no component or store imports `@tauri-apps/plugin-updater`, which needs a Tauri bridge
  that jsdom does not have. These are plugin commands, not ours, so they never appear in
  `bindings.ts`. The service also holds the plugin's `Update` object — a **native resource**
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
failure paths testable at all. `FakeAttachmentsRepository` and `FakeTransferRepository` follow
the same pattern; `FakeFileDialog` and `FakeAppWindow` stand in for the two native services.

`FakeNotesRepository`'s deletion is a **soft** one, like the real back-end's: a deleted note
moves to its trash list, which is what makes undo and the trash panel observable at all.
`FakeAppWindow` is provided in **every** spec, not only those that need it: a real `exit()`
would take the test runner down with the application.

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

Unit tests are inline `#[cfg(test)] mod tests` blocks at the bottom of the file they cover —
the idiomatic Rust form, and the one that keeps a test next to what it asserts. Shared
fixtures for the notes tests live in `notes::fixtures`, a `#[cfg(test)]` module in `notes.rs`.
`src-tauri/tests/` holds the integration binaries, which see only the crate's public API.

The tests split by what they need in order to run:

- **Model, view and language** — pure, no database, milliseconds to run. Section placement and
  exhaustiveness, local-midnight boundaries, absurd timezone offsets, tag normalisation,
  Unicode search folding, footer choice, expiry thresholds, the refusal of an unreadable
  `now`, and the JSON wire shape.
- **The stores** — against `open_in_memory()`, which applies the **real** migrations, so the
  tests exercise the actual schema, constraints and cascades rather than a stand-in. They pass
  timestamps explicitly instead of reading the clock, which makes assertions on `created_at` /
  `updated_at` deterministic. A `query` helper in the test module recomposes
  `fetch` + `notes::view::build` so the whole read path stays covered end to end.
- **`db` and `error`** — that a poisoned mutex reports `storageUnavailable` instead of
  panicking a second time, and that each error variant maps to the right code and params.

Test names and comments are in English, like the front-end specs. `notes::store::list`
survives only as a `#[cfg(test)]` helper — no command returns a raw list.
