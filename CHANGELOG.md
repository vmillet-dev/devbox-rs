# Changelog

Notable changes to DevBox, newest first.

**The newest section is generated.** `.github/workflows/release.yml` writes it from the pull
requests merged since the last tag, then commits it **before** creating the tag — this file is
shipped inside the binary (`src-tauri/src/changelog.rs` embeds it with `include_str!`) and read
by "À propos → Nouveautés", so a release whose section came after the tag would ship a binary
missing its own entry. Sections already written are never touched: edit them by hand freely.

Keep the shape — a `## ` heading per release, `### ` headings for the categories, one `- `
bullet per entry — or the entry will not be rendered. It is deliberately untranslated, like
the release notes the updater hands over.

## [0.2.0] - 2026-09-16

### ✨ Added

- Say what a bulk action touches, and offer to take it back (#146)
- Check the library is sound, and offer a way out when it is not (#145)
- Take a rolling copy of the library at launch (#144)
- Declare the two mirrored rules once, in Rust (#142)
- Give the four files with no spec one each (#141)
- Encrypt the library at rest, behind a passphrase (#135)

### 🐛 Fixed

- Write only the columns an edit moved (#140)
- Compare the query params exhaustively, like the patch table next door (#139)
- Seed the first launch as one write (#138)
- Let a storage failure reach the screen instead of killing the launch (#137)
- Choose the durability rather than inherit it (#136)

### 🧰 Under the hood

- Measure what a query costs as the corpus grows (#143)

## [0.1.4] - 2026-09-16

### ✨ Added

- Measure what the commands cost, and save a baseline (#126)
- Let a space be pinned to the head of the list (#125)
- Leave a filtered canvas in one gesture (#123)
- Say how many notes a search matched, and why each one is there (#112)
- Give a card's body the line the badge row was taking (#111)
- Let an update be silenced, and say it is still there (#100)
- Remember the window's size and position (#99)
- Add Rust, Go, Java, C#, PHP and C to the language list (#96)

### 🔧 Changed

- Let a red E2E leg block the run (#109)

### 🐛 Fixed

- Show a todo list the item a search found it by (#124)
- Keep the tag rail's Manage button out of the row that scrolls (#122)
- Make the e2e suite tell the truth, and fix what it was telling (#101)
- Degrade a bundle from a newer version instead of refusing it whole (#95)
- Fold the accents in search, not just the case (#94)
- Give every text field its text cursor back (#93)
- Make fullscreen actually fill the screen (#92)
- Align the attachments band with the editor's other bands (#90)

### 🧰 Under the hood

- Keep the comments that say what the code cannot (#128)
- Refilm the README, and drop the screenshot the GIF repeats (#113)
- Give a card title its width back, and plant the pin in the corner (#114)
- Say which platforms DevBox ships for, and stop implying macOS (#110)
- Make the e2e suite pass, and fix the data loss it was reporting
- Film the README on a full board (#105)
- Show a note created while its editor was closing (#104)
- Make the README a front door (#103)
- Bump the rust-minor group across 1 directory with 8 updates (#91)
- Bump eslint from 9.39.5 to 10.10.0 (#89)
- Bump @eslint/js from 9.39.5 to 10.0.1 (#87)
- Bump png from 0.17.16 to 0.18.1 in /src-tauri (#84)
- Bump the npm-minor group with 15 updates (#86)
- Bump base64 from 0.22.1 to 0.23.1 in /src-tauri (#85)
- Bump toml from 0.9.12+spec-1.1.0 to 1.1.3+spec-1.1.0 in /src-tauri (#83)
- Bump the actions group with 7 updates (#81)
- Review the Rust back-end (#75)

## [0.1.3] - 2026-09-13

### ✨ Added

- Open in the system language when none has been chosen (#53)

### 🐛 Fixed

- Move the titlebar menus to the left (#52)

### 🧰 Under the hood

- Generate the changelog from merged pull requests and their labels (#67)
- Add e2e testing harness (#66)
- Give the front-end tree the shape of the interface (#65)
- The section and the card read their own state (#63)
- The editor overlay reaches for its own stores (#62)
- Delete the contribution registries, each menu owns its actions (#61)
- Describe the application from Cargo.toml, at compile time (#58)
- Size dialogs with CSS custom properties, not inputs (#57)
- Drop the DTO aliases, rename note.dto.ts to note.mapper.ts (#56)
- Merge AppShellComponent into AppComponent (#51)
- Enhance code safety, optimize performance, and improve documentation (#8)

## [0.1.2] - 2026-09-11

### ✨ Added

- **Todo-list notes.** A note is now either a snippet or a checklist: ordered items, ticked from
  the card without opening it, reordered with the pointer or `Alt+↑` / `Alt+↓`.
- **`{{field}}` values are kept.** What you type into a snippet's fields is stored with the note,
  and global variables (Preferences → Variables) propose a value for the whole corpus.
- **Preferences panel.** Theme, density, tray behaviour, start with the system, the quick-paste
  shortcut and copy confirmations, all applied as they are typed.
- **Help in the About menu:** "Nouveautés" (this file), "Prise en main" and "Raccourcis clavier".
- **Sample notes on first launch**, in their own space, to show what a note can carry.

## [0.1.1] - 2026-08-27

### 🐛 Fixed

- Various fixes to note editing and to the test suite.

## [0.1.0] - 2026-07-28

### ✨ Added

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
