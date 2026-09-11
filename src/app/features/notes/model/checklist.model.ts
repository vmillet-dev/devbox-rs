/**
 * Le vocabulaire des notes todolist.
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
 * ⚠️ Markdown rendering for the clipboard. Mirrors `notes::checklist::to_markdown`
 * on the Rust side, which serves sharing: two uses, two paths, one syntax.
 */
export function checklistToText(items: readonly ChecklistItem[]): string {
  return items.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`).join('\n');
}

/** What a note puts on the clipboard, depending on what it is. */
export function noteCopyText(note: {
  readonly kind: NoteKind;
  readonly content: string;
  readonly items: readonly ChecklistItem[];
}): string {
  return note.kind === 'checklist' ? checklistToText(note.items) : note.content;
}
