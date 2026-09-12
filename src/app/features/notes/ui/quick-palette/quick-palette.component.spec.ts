import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { createNote } from '@testing/note.fixture';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { QuickPaletteComponent } from './quick-palette.component';

const RESULTS = [
  createNote({ id: 'note-1', title: 'First', content: 'one\ntwo\nthree' }),
  createNote({
    id: 'note-2',
    title: 'Templated',
    content: 'psql -h {{host}}',
    placeholders: [{ name: 'host', defaultValue: '', value: '' }],
  }),
];

describe('QuickPaletteComponent', () => {
  let fixture: ComponentFixture<QuickPaletteComponent>;

  function input(): HTMLInputElement {
    return fixture.nativeElement.querySelector('.palette-input');
  }

  function options(): HTMLElement[] {
    return [...fixture.nativeElement.querySelectorAll('.palette-option')];
  }

  async function press(key: string): Promise<void> {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [QuickPaletteComponent],
      providers: [provideTranslocoTesting()],
    });
    fixture = TestBed.createComponent(QuickPaletteComponent);
    fixture.componentRef.setInput('results', RESULTS);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  it('takes the focus on the search field', () => {
    expect(document.activeElement).toBe(input());
  });

  it('marks the highlighted option without moving the focus', async () => {
    fixture.componentRef.setInput('highlighted', 1);
    await fixture.whenStable();

    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[1].id);
    expect(document.activeElement).toBe(input());
  });

  it('walks the list with the arrow keys', async () => {
    const moves: number[] = [];
    fixture.componentInstance.highlightMoved.subscribe((step) => moves.push(step));

    await press('ArrowDown');
    await press('ArrowUp');

    expect(moves).toEqual([1, -1]);
  });

  it('copies on Enter', async () => {
    let chosen = 0;
    fixture.componentInstance.chosen.subscribe(() => (chosen += 1));

    await press('Enter');

    expect(chosen).toBe(1);
  });

  it('opens the highlighted note on Tab instead of copying it', async () => {
    let opened: string | undefined;
    fixture.componentInstance.openRequested.subscribe((id) => (opened = id));
    fixture.componentRef.setInput('highlighted', 1);
    await fixture.whenStable();

    await press('Tab');

    expect(opened).toBe('note-2');
  });

  it('closes on Escape', async () => {
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => (closed += 1));

    await press('Escape');

    expect(closed).toBe(1);
  });

  it('flags a snippet that will ask for values', () => {
    expect(options()[0].querySelector('.palette-option-fields')).toBeNull();
    expect(options()[1].querySelector('.palette-option-fields')?.textContent).toContain('1');
  });

  it('trims the preview to a couple of lines', () => {
    expect(options()[0].querySelector('.palette-option-snippet')?.textContent).toBe('one\ntwo');
  });

  it('says when nothing matches', async () => {
    fixture.componentRef.setInput('results', []);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.palette-empty').textContent).toContain('Aucun');
  });

  it('reports the choice made with the mouse', async () => {
    let index: number | undefined;
    let chosen = 0;
    fixture.componentInstance.highlightSet.subscribe((value) => (index = value));
    fixture.componentInstance.chosen.subscribe(() => (chosen += 1));

    (options()[1].querySelector('.palette-option-button') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(index).toBe(1);
    expect(chosen).toBe(1);
  });
  describe('the create row', () => {
    async function offerCreation(query: string): Promise<void> {
      fixture.componentRef.setInput('query', query);
      fixture.componentRef.setInput('canCreate', true);
      await fixture.whenStable();
    }

    it('is absent while there is nothing to create', () => {
      expect(fixture.nativeElement.querySelector('.palette-create')).toBeNull();
    });

    it('comes last, quoting what was typed', async () => {
      await offerCreation('migrer la base');

      const rows = options();
      expect(rows).toHaveLength(3);
      expect(rows[2].classList).toContain('palette-create');
      expect(rows[2].textContent).toContain('migrer la base');
    });

    it('replaces the empty state rather than sitting next to it', async () => {
      fixture.componentRef.setInput('results', []);
      await offerCreation('migrer la base');

      expect(fixture.nativeElement.querySelector('.palette-empty')).toBeNull();
      expect(fixture.nativeElement.querySelector('.palette-create')).not.toBeNull();
    });

    it('is chosen like any other option', async () => {
      await offerCreation('migrer la base');
      let index: number | undefined;
      let chosen = 0;
      fixture.componentInstance.highlightSet.subscribe((value) => (index = value));
      fixture.componentInstance.chosen.subscribe(() => (chosen += 1));

      (fixture.nativeElement.querySelector('.palette-create button') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(index).toBe(2);
      expect(chosen).toBe(1);
    });

    it('has no note to open on Tab', async () => {
      await offerCreation('migrer la base');
      fixture.componentRef.setInput('highlighted', 2);
      await fixture.whenStable();
      let opened = 0;
      fixture.componentInstance.openRequested.subscribe(() => (opened += 1));

      await press('Tab');

      expect(opened).toBe(0);
    });
  });
});
