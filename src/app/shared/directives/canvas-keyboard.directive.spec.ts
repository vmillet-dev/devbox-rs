import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogStack } from '@shared/layout/dialog/dialog-stack';
import { dialogRung } from '@shared/layout/dialog/dialog.model';
import { NotesHarness, awaitQuery, createNotesHarness } from '@testing/notes-harness';
import { createNote } from '@testing/note.fixture';
import { CANVAS_SHORTCUT_GROUP, CanvasKeyboardDirective } from './canvas-keyboard.directive';

@Component({
  selector: 'app-canvas-keyboard-host',
  hostDirectives: [CanvasKeyboardDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card-shell" id="card-1"></div>
    <div class="card-shell" id="card-2"></div>
    <input id="field" />
  `,
})
class CanvasKeyboardHostComponent {}

const NOTES = [
  createNote({ id: 'note-1', title: 'First', content: 'first body' }),
  createNote({ id: 'note-2', title: 'Second', content: 'second body' }),
];

describe('CanvasKeyboardDirective', () => {
  let fixture: ComponentFixture<CanvasKeyboardHostComponent>;
  let harness: NotesHarness;

  function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    document.dispatchEvent(event);
    return event;
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    harness = await createNotesHarness([...NOTES]);
    // Standalone: created straight from the module the harness already configured.
    fixture = TestBed.createComponent(CanvasKeyboardHostComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    harness.selection.focusIndex(0);
  });

  /** ⚠️ Documenting a key and binding it are the same act: the sheet is derived here. */
  it('documents exactly the keys it declares, in reading order', () => {
    expect(CANVAS_SHORTCUT_GROUP.id).toBe('notes.canvas');
    expect(CANVAS_SHORTCUT_GROUP.shortcuts[0].keys).toEqual(['Ctrl', 'K']);
    expect(CANVAS_SHORTCUT_GROUP.shortcuts.every((shortcut) => shortcut.labelKey.length > 0)).toBe(true);
  });

  describe('acting on the focused note', () => {
    it('copies it', async () => {
      const event = press('c');
      await fixture.whenStable();

      expect(harness.clipboard.content).toBe('first body');
      expect(event.defaultPrevented).toBe(true);
    });

    it('ticks it', () => {
      press('x');

      expect(harness.selection.checkedNoteIds()).toEqual(['note-1']);
    });

    it('pins it', async () => {
      press('p');
      await vi.waitFor(() =>
        expect(harness.canvas.visibleNotes().find((note) => note.id === 'note-1')?.pinned).toBe(true),
      );
    });

    it('opens it', () => {
      press('Enter');

      expect(harness.store.selectedNoteId()).toBe('note-1');
    });

    it('takes the uppercase letter too, for a caps-locked keyboard', async () => {
      press('C');
      await fixture.whenStable();

      expect(harness.clipboard.content).toBe('first body');
    });
  });

  describe('what it refuses to act on', () => {
    /** ⚠️ A key that acted is the only one whose default is cancelled. */
    it('leaves the browser alone when nothing was focused', () => {
      harness.selection.focusNote(null);

      const event = press('c');

      expect(event.defaultPrevented).toBe(false);
      expect(harness.clipboard.content).toBe('');
    });

    it('stays out of a field being typed in', () => {
      const field: HTMLInputElement = fixture.nativeElement.querySelector('#field');
      field.focus();

      const event = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
      field.dispatchEvent(event);

      expect(harness.selection.checkedNoteIds()).toEqual([]);
      expect(event.defaultPrevented).toBe(false);
    });

    /** The canvas keyboard is taken for as long as anything is open over it. */
    it('says nothing while a dialog is open', () => {
      TestBed.inject(DialogStack).push({}, dialogRung('editor'));

      press('x');

      expect(harness.selection.checkedNoteIds()).toEqual([]);
    });

    /** ⚠️ A bare key stays bare: Alt is a different gesture entirely. */
    it('ignores a bound key held with Alt', () => {
      press('x', { altKey: true });

      expect(harness.selection.checkedNoteIds()).toEqual([]);
    });

    it('ignores a bare key that wants Ctrl, and the other way round', () => {
      press('z');
      expect(harness.store.lastDeletion()).toBeNull();

      const withCtrl = press('c', { ctrlKey: true });
      expect(withCtrl.defaultPrevented).toBe(false);
    });

    it('leaves a key it does not bind alone', () => {
      const event = press('q');

      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('Escape falls through', () => {
    it('clears the selection first', () => {
      harness.selection.toggleChecked('note-1');

      press('Escape');

      expect(harness.selection.checkedNoteIds()).toEqual([]);
    });

    it('clears the filters once nothing is selected', async () => {
      harness.canvas.setSearchQuery('first');
      // ⚠️ Waited for: the search is debounced, and pressing Escape before the query left
      // would undo a filter that had not been applied yet.
      await vi.waitFor(() => expect(harness.repository.lastQuery?.search).toBe('first'));
      const before = harness.repository.queryCount;

      press('Escape');
      await awaitQuery(harness.repository, before);

      expect(harness.repository.lastQuery?.search).toBe('');
    });

    it('does nothing at all when there is neither', () => {
      const event = press('Escape');

      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('moving the focus', () => {
    it('takes the first card when nothing is focused yet', () => {
      harness.selection.focusNote(null);

      press('ArrowRight');

      expect(harness.selection.focusedIndex()).toBe(0);
    });

    it('walks to the next card', () => {
      press('ArrowRight');

      expect(harness.selection.focusedIndex()).toBe(1);
    });

    it('claims the arrow, so the page does not scroll under the canvas', () => {
      const event = press('ArrowDown');

      expect(event.defaultPrevented).toBe(true);
    });
  });
});
