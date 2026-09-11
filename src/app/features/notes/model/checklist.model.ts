/**
 * The vocabulary of todo-list notes.
 *
 * The functions are pure and inject nothing: they present data the front
 * already holds. The same deliberate exception as relative-time formatting — an
 * IPC round trip to count an array received with the note would be absurd.
 *
 * Both types are plain aliases of the **generated** unions, like `LanguageTag`:
 * an `import type` is erased at compile time, and the value boundary
 * (`commands`) stays in `data/`.
 */
import type { ChecklistItem, NoteKind } from '@core/ipc/bindings';

export type { ChecklistItem, NoteKind };

export interface ChecklistProgress {
  readonly done: number;
  readonly total: number;
  /** 0 to 100. An empty list is 0: nothing to do is not "all done". */
  readonly percent: number;
}

export function checklistProgress(items: readonly ChecklistItem[]): ChecklistProgress {
  const done = items.filter((item) => item.done).length;
  const total = items.length;

  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/**
 * What a note puts on the clipboard.
 *
 * A todo list's Markdown is **not** rendered here: `copyText` carries what
 * `notes::checklist::to_markdown` produced, which is also what sharing and
 * exporting emit. The front end used to hold a second copy of the `- [x] `
 * syntax, and one of the two was going to drift.
 */
export function noteCopyText(note: { readonly content: string; readonly copyText: string | null }): string {
  return note.copyText ?? note.content;
}
