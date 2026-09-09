/**
 * Le vocabulaire des notes todolist.
 *
 * Les fonctions sont pures et sans injection : elles présentent une donnée que
 * le front tient déjà. C'est la même exception assumée que le formatage du
 * temps relatif — un aller-retour IPC pour compter un tableau reçu avec la note
 * serait absurde.
 *
 * Les deux types sont de simples alias des unions **générées**, comme
 * `LanguageTag` l'est de `Language` : un `import type` s'efface à la
 * compilation, et la frontière de valeurs (`commands`) reste dans `data/`.
 * Une variante ajoutée en Rust apparaît ici à la régénération.
 */
import type { ChecklistItem, NoteKind } from '@core/ipc/bindings';

export type { ChecklistItem, NoteKind };

export interface ChecklistProgress {
  readonly done: number;
  readonly total: number;
  /** 0 à 100. Une liste vide vaut 0 : rien à faire n'est pas « tout fait ». */
  readonly percent: number;
}

export function checklistProgress(items: readonly ChecklistItem[]): ChecklistProgress {
  const done = items.filter((item) => item.done).length;
  const total = items.length;

  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/**
 * Rendu Markdown, pour le presse-papier. Même forme que `notes::checklist::to_markdown`
 * côté Rust, qui sert au partage : deux usages, deux chemins, une seule syntaxe.
 */
export function checklistToText(items: readonly ChecklistItem[]): string {
  return items.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`).join('\n');
}

/** Ce qu'une note met dans le presse-papier, selon ce qu'elle est. */
export function noteCopyText(note: {
  readonly kind: NoteKind;
  readonly content: string;
  readonly items: readonly ChecklistItem[];
}): string {
  return note.kind === 'checklist' ? checklistToText(note.items) : note.content;
}
