import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChecklistItem } from '@features/notes/model/note.model';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { ChecklistEditorComponent } from './checklist-editor.component';

describe('ChecklistEditorComponent', () => {
  let fixture: ComponentFixture<ChecklistEditorComponent>;
  let emitted: (readonly ChecklistItem[])[];

  const ITEMS: ChecklistItem[] = [
    { text: 'Relire', done: true },
    { text: 'Déployer', done: false },
  ];

  function rows(): HTMLInputElement[] {
    return [...fixture.nativeElement.querySelectorAll('.row-text')];
  }

  function last(): readonly ChecklistItem[] {
    return emitted[emitted.length - 1];
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function key(target: Element, init: KeyboardEventInit): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ChecklistEditorComponent],
      providers: [provideTranslocoTesting()],
    });
    fixture = TestBed.createComponent(ChecklistEditorComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.componentRef.setInput('items', ITEMS);
    fixture.componentRef.setInput('noteId', 'note-1');
    fixture.autoDetectChanges();
    await fixture.whenStable();

    emitted = [];
    fixture.componentInstance.itemsChanged.subscribe((items) => emitted.push(items));
  });

  it('shows the progress graphically and as text', () => {
    const fill = fixture.nativeElement.querySelector('.progress-fill') as HTMLElement;

    expect(fill.style.width).toBe('50%');
    expect(fixture.nativeElement.querySelector('.progress-count').textContent.trim()).toBe('1/2 tâche(s)');
  });

  it('commits a tick straight away, a discrete gesture having nothing to wait for', async () => {
    fixture.nativeElement.querySelectorAll('.row-check')[1].click();
    await fixture.whenStable();

    expect(last()).toEqual([
      { text: 'Relire', done: true },
      { text: 'Déployer', done: true },
    ]);
  });

  it('keeps typing local until the field is left', async () => {
    type(rows()[0], 'Relire deux fois');
    await fixture.whenStable();

    expect(emitted).toEqual([]);

    rows()[0].dispatchEvent(new Event('blur'));
    await fixture.whenStable();

    expect(last()[0]).toEqual({ text: 'Relire deux fois', done: true });
  });

  it('inserts a row after the current one on Enter', async () => {
    key(rows()[0], { key: 'Enter' });
    await fixture.whenStable();

    expect(last().map((item) => item.text)).toEqual(['Relire', '', 'Déployer']);
  });

  it('deletes an empty row on Backspace rather than doing nothing', async () => {
    type(rows()[1], '');
    key(rows()[1], { key: 'Backspace' });
    await fixture.whenStable();

    expect(last().map((item) => item.text)).toEqual(['Relire']);
  });

  it('leaves a row alone when Backspace has text to eat', async () => {
    key(rows()[1], { key: 'Backspace' });
    await fixture.whenStable();

    expect(emitted).toEqual([]);
  });

  it('appends an empty row from the add button', async () => {
    fixture.nativeElement.querySelector('.checklist-add').click();
    await fixture.whenStable();

    expect(last()).toHaveLength(3);
  });

  it('removes the row the delete button belongs to', async () => {
    fixture.nativeElement.querySelectorAll('.row-remove')[0].click();
    await fixture.whenStable();

    expect(last().map((item) => item.text)).toEqual(['Déployer']);
  });

  it('reorders with Alt+Arrow, since the drag gesture is unreachable by keyboard', async () => {
    key(rows()[1], { key: 'ArrowUp', altKey: true });
    await fixture.whenStable();

    expect(last().map((item) => item.text)).toEqual(['Déployer', 'Relire']);
  });

  it('refuses to move a row past either end', async () => {
    key(rows()[0], { key: 'ArrowUp', altKey: true });
    await fixture.whenStable();

    expect(emitted).toEqual([]);
  });

  describe('reordering by pointer', () => {
    // ⚠️ HTML5 drag & drop does not work in this WebView: the pointer events are the
    // path to cover, not a `dragstart` that would never arrive.
    function grip(index: number): HTMLElement {
      return fixture.nativeElement.querySelectorAll('.row-grip')[index];
    }

    function pointer(target: Element, type: string, clientY = 0, button = 0): void {
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientY, button, pointerId: 1 }));
    }

    beforeEach(() => {
      // Two 20px rows: jsdom lays nothing out.
      const rowElements = fixture.nativeElement.querySelectorAll('.row-text');
      rowElements.forEach((row: HTMLElement, index: number) => {
        row.getBoundingClientRect = () => ({ top: index * 20, bottom: (index + 1) * 20 }) as DOMRect;
      });
    });

    it('moves the dragged row to where the pointer was released', async () => {
      pointer(grip(1), 'pointerdown');
      pointer(grip(1), 'pointermove', 5);
      pointer(grip(1), 'pointerup');
      await fixture.whenStable();

      expect(last().map((item) => item.text)).toEqual(['Déployer', 'Relire']);
    });

    it('previews the move before it is released, without writing', async () => {
      pointer(grip(1), 'pointerdown');
      pointer(grip(1), 'pointermove', 5);
      await fixture.whenStable();

      const order = [...fixture.nativeElement.querySelectorAll('.checklist-row')].map(
        (row) => (row as HTMLElement).style.order,
      );
      expect(order).toEqual(['1', '0']);
      expect(emitted).toEqual([]);
    });

    it('writes nothing when the row is dropped where it started', async () => {
      pointer(grip(0), 'pointerdown');
      pointer(grip(0), 'pointermove', 5);
      pointer(grip(0), 'pointerup');
      await fixture.whenStable();

      expect(emitted).toEqual([]);
    });

    it('ignores a move that no drag started', async () => {
      pointer(grip(0), 'pointermove', 30);
      pointer(grip(0), 'pointerup');
      await fixture.whenStable();

      expect(emitted).toEqual([]);
    });

    it('ignores anything but the primary button', async () => {
      pointer(grip(1), 'pointerdown', 0, 2);
      pointer(grip(1), 'pointermove', 5);
      pointer(grip(1), 'pointerup');
      await fixture.whenStable();

      expect(emitted).toEqual([]);
    });

    it('drops onto the last row when the pointer runs off the bottom', async () => {
      pointer(grip(0), 'pointerdown');
      pointer(grip(0), 'pointermove', 500);
      pointer(grip(0), 'pointerup');
      await fixture.whenStable();

      expect(last().map((item) => item.text)).toEqual(['Déployer', 'Relire']);
    });

    it('abandons the move when the gesture is cancelled by the system', async () => {
      pointer(grip(1), 'pointerdown');
      pointer(grip(1), 'pointermove', 5);
      pointer(grip(1), 'pointercancel');
      await fixture.whenStable();

      expect(last().map((item) => item.text)).toEqual(['Déployer', 'Relire']);
    });
  });

  it('commits on demand, for the closing paths that produce no blur', async () => {
    type(rows()[0], 'Modifié');
    await fixture.whenStable();

    fixture.componentInstance.commit();

    expect(last()[0].text).toBe('Modifié');
  });

  it('rebases the draft on the note id, not on the note object', async () => {
    type(rows()[0], 'En cours de frappe');
    await fixture.whenStable();

    fixture.componentRef.setInput('items', [...ITEMS]);
    await fixture.whenStable();
    expect(rows()[0].value).toBe('En cours de frappe');

    fixture.componentRef.setInput('noteId', 'note-2');
    fixture.componentRef.setInput('items', [{ text: 'Autre', done: false }]);
    await fixture.whenStable();
    expect(rows().map((row) => row.value)).toEqual(['Autre']);
  });
});
