import { Injectable, computed, signal } from '@angular/core';

/** An open dialog, and the rung it sits on. */
interface StackEntry {
  readonly owner: object;
  readonly rung: number;
}

/**
 * Which modal is in front, so Escape reaches one dialog and not all of them.
 *
 * Every open dialog listens on `document`, so without this they all answer the
 * same keystroke. That used to be patched case by case — the editor checked
 * whether the lightbox was open, and the "About" menu's four panels shared one
 * signal so two could never stack.
 *
 * ⚠️ Ordered by **rung** and not by arrival: a dialog opened by another one
 * (the fields form, from the palette) is created second in the DOM but drawn in
 * front, and Escape has to follow what is on screen. Ties break on arrival.
 */
@Injectable({ providedIn: 'root' })
export class DialogStack {
  private readonly entries = signal<readonly StackEntry[]>([]);

  /** Whether anything at all is open — what tells a page its keyboard is taken. */
  readonly hasOpenDialog = computed(() => this.entries().length > 0);

  push(owner: object, rung: number): void {
    this.entries.update((open) => [...open, { owner, rung }]);
  }

  remove(owner: object): void {
    this.entries.update((open) => open.filter((entry) => entry.owner !== owner));
  }

  isFront(owner: object): boolean {
    const open = this.entries();
    const front = open.reduce<StackEntry | null>(
      (best, entry) => (best === null || entry.rung >= best.rung ? entry : best),
      null,
    );

    return front?.owner === owner;
  }
}
