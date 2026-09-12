# Changelog

Notable changes to DevBox, newest first.

This file is **shipped inside the binary** (`src-tauri/src/changelog.rs` embeds it with
`include_str!`) and read by "À propos → Nouveautés". Keep the shape below — a `## ` heading per
release, `### ` headings for the categories, one `- ` bullet per entry — or the entry will not be
rendered. It is deliberately untranslated, like the release notes the updater hands over.

## [Unreleased]

### Added

- **Todo-list notes.** A note is now either a snippet or a checklist: ordered items, ticked from
  the card without opening it, reordered with the pointer or `Alt+↑` / `Alt+↓`.
- **`{{field}}` values are kept.** What you type into a snippet's fields is stored with the note,
  and global variables (Preferences → Variables) propose a value for the whole corpus.
- **Preferences panel.** Theme, density, tray behaviour, start with the system, the quick-paste
  shortcut and copy confirmations, all applied as they are typed.
- **Help in the About menu:** "Nouveautés" (this file), "Prise en main" and "Raccourcis clavier".
- **Sample notes on first launch**, in their own space, to show what a note can carry.

### Changed

- **The interface language is a preference**, in Préférences → Apparence: Système, Français or
  Anglais. `Système` follows the display language of the machine — English when it speaks
  neither — and keeps following it until you pick one yourself. The `FR` / `EN` buttons in the
  titlebar are still there and set an explicit language.
- **The About card says what DevBox is**, and names the Angular, Rust and Tauri versions it
  was built with.
- **The Fichier and À propos menus moved to the left** of the titlebar, where a menu bar
  belongs on Windows and Linux.

## [0.1.1] - 2026-08-27

### Fixed

- Various fixes to note editing and to the test suite.

## [0.1.0] - 2026-07-28

### Added

- **Notes and spaces.** Spaces to file notes in, with creation, renaming and deletion — deleting a
  space moves its notes rather than dropping them.
- **The canvas.** Sections by age, pinned notes first, full-text search, tag rail, language rail and
  quick filters, all computed by the Rust engine.
- **The editor.** Title, body, language, tags, source, pin, deadline, move to another space.
- **Syntax highlighting** of the body, for thirteen languages.
- **`{{fields}}` in a snippet**, filled before copying.
- **Trash with a 30-day retention**, and `Ctrl+Z` to undo a deletion.
- **Attachments**, dropped on the window or pasted from the clipboard.
- **Import, export and share** as a bundle or as Markdown.
- **Quick-paste palette** on a global shortcut, plus capture and new note.
- **System tray**, translated, with the window filed away on close.
- **Signed application updates**, offered and never installed behind your back.
- **French and English interface.**
