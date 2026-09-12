import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Space } from '@notes/model/space.model';
import { LanguageBadgeComponent } from '@notes/ui/language-badge/language-badge.component';
import { NoteSelectionStore } from '@notes/state/note-selection.store';
import { NotesQueryStore } from '@notes/state/notes-query.store';
import { NotesStore } from '@notes/state/notes.store';
import { PlaceholderFillStore } from '@notes/state/placeholder-fill.store';
import { createNote } from '@testing/note.fixture';
import { provideAppTesting } from '@testing/testing.providers';
import { CopyButtonComponent } from '@notes/ui/copy-button/copy-button.component';
import { NoteCardMenuComponent } from './note-card-menu/note-card-menu.component';
import { NoteActivation, NoteCardComponent } from './note-card.component';

/** A literal, so the expected strings stay on one line. */
const NEWLINE = String.fromCharCode(10);

const SPACES: readonly Space[] = [
  { id: 'work', name: 'Work' },
  { id: 'personal', name: 'Personal' },
];

describe('NoteCardComponent', () => {
  let fixture: ComponentFixture<NoteCardComponent>;

  function text(selector: string): string {
    return fixture.nativeElement.querySelector(selector).textContent.replace(/\s+/g, ' ').trim();
  }

  beforeEach(() => {
    // Only virtualize `Date`; Angular's zoneless scheduler relies on real rAF/setTimeout for `whenStable()` to resolve.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));

    TestBed.configureTestingModule({
      imports: [NoteCardComponent],
      // The store answers about notes the canvas holds, so the card's own note is one.
      providers: [provideAppTesting({ spaces: SPACES, notes: [createNote({ id: 'note-42' })] })],
    });
    fixture = TestBed.createComponent(NoteCardComponent);
    fixture.componentRef.setInput('note', createNote());
    fixture.autoDetectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the title and passes the language down to the language badge', async () => {
    fixture.componentRef.setInput('note', createNote({ title: 'My note', language: 'json' }));
    await fixture.whenStable();

    expect(text('.card-title')).toBe('My note');
    const badge = fixture.debugElement.query(By.directive(LanguageBadgeComponent))
      .componentInstance as LanguageBadgeComponent;
    expect(badge.language()).toBe('json');
  });

  it('falls back to a translated placeholder for an untitled note', async () => {
    fixture.componentRef.setInput('note', createNote({ title: '' }));
    await fixture.whenStable();

    expect(text('.card-title')).toBe('Sans titre');
  });

  it('shows only the first 3 lines of content as a snippet', async () => {
    fixture.componentRef.setInput('note', createNote({ content: 'one\ntwo\nthree\nfour' }));
    await fixture.whenStable();

    const lines = fixture.debugElement.queryAll(By.css('.card-snippet .line-content'));
    expect(lines.map((line) => line.nativeElement.textContent)).toEqual(['one', 'two', 'three']);
  });

  it('colours the snippet according to the note language', async () => {
    fixture.componentRef.setInput('note', createNote({ language: 'json', content: '{"a": 1}' }));
    await fixture.whenStable();

    expect(fixture.debugElement.query(By.css('.card-snippet .hljs-attr'))).not.toBeNull();
  });

  it('numbers no line in the snippet', async () => {
    fixture.componentRef.setInput('note', createNote({ content: 'one\ntwo' }));
    await fixture.whenStable();

    expect(fixture.debugElement.queryAll(By.css('.card-snippet .line-no'))).toHaveLength(0);
  });

  it('shows at most 2 tags', async () => {
    fixture.componentRef.setInput('note', createNote({ tags: ['a', 'b', 'c'] }));
    await fixture.whenStable();

    const tags = fixture.debugElement.queryAll(By.css('.card-tags span'));
    expect(tags.map((tag) => tag.nativeElement.textContent)).toEqual(['#a', '#b']);
  });

  /**
   * Which footer a note gets is decided in Rust and tested there. What is left here is
   * rendering the variant that arrives, dated ones formatted locally so the label keeps
   * ageing on screen.
   */
  describe('footer', () => {
    it('renders an expiry footer as a countdown', async () => {
      fixture.componentRef.setInput(
        'note',
        createNote({ footer: { kind: 'expiry', at: new Date('2026-01-13T12:00:00Z') } }),
      );
      await fixture.whenStable();

      expect(text('.card-footer span')).toBe('expire dans 3j');
    });

    it('renders an age footer as a relative time', async () => {
      fixture.componentRef.setInput(
        'note',
        createNote({ footer: { kind: 'age', at: new Date('2026-01-10T11:00:00Z') } }),
      );
      await fixture.whenStable();

      expect(text('.card-footer span')).toBe('il y a 1h');
    });

    it('renders a source footer as plain text, with nothing to translate', async () => {
      fixture.componentRef.setInput('note', createNote({ footer: { kind: 'source', value: 'API Gateway' } }));
      await fixture.whenStable();

      expect(text('.card-footer span')).toBe('API Gateway');
    });

    it('marks the footer stale on the backend flag, not on a threshold of its own', async () => {
      fixture.componentRef.setInput('note', createNote({ expiringSoon: true }));
      await fixture.whenStable();

      expect(fixture.debugElement.query(By.css('.card-footer span')).classes['stale']).toBe(true);
    });
  });

  it('exposes the pinned state as text, since the design only conveys it with a pictogram', async () => {
    fixture.componentRef.setInput('note', createNote({ pinned: true }));
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.visually-hidden').textContent).toBe('Note épinglée');
  });

  it('marks itself pinned from the note, and selected from the store', async () => {
    fixture.componentRef.setInput('note', createNote({ id: 'note-42', pinned: true }));
    await vi.waitFor(() => expect(TestBed.inject(NotesQueryStore).visibleNotes()).toHaveLength(1));

    TestBed.inject(NotesStore).openNote('note-42');
    await fixture.whenStable();

    const card = fixture.debugElement.query(By.css('.card'));
    expect(card.classes['pinned']).toBe(true);
    expect(card.classes['selected']).toBe(true);
  });

  it('keeps the card button free of flow content, which a <button> may not contain', () => {
    expect(fixture.nativeElement.querySelectorAll('button div')).toHaveLength(0);
  });

  it('emits opened with the note id when clicked', async () => {
    fixture.componentRef.setInput('note', createNote({ id: 'note-42' }));
    await fixture.whenStable();
    let emitted: string | undefined;
    fixture.componentInstance.opened.subscribe(({ noteId }) => (emitted = noteId));

    fixture.debugElement.query(By.css('.card')).triggerEventHandler('click', new MouseEvent('click'));

    expect(emitted).toBe('note-42');
  });

  it('reports the click modifiers instead of deciding what they mean', async () => {
    fixture.componentRef.setInput('note', createNote({ id: 'note-42' }));
    await fixture.whenStable();
    const activations: NoteActivation[] = [];
    fixture.componentInstance.opened.subscribe((activation) => activations.push(activation));
    const card = fixture.debugElement.query(By.css('.card'));

    card.triggerEventHandler('click', new MouseEvent('click', { ctrlKey: true }));
    card.triggerEventHandler('click', new MouseEvent('click', { shiftKey: true }));

    expect(activations).toEqual([
      { noteId: 'note-42', toggleChecked: true, extendRange: false },
      { noteId: 'note-42', toggleChecked: false, extendRange: true },
    ]);
  });

  it('checks the note without opening it', async () => {
    fixture.componentRef.setInput('note', createNote({ id: 'note-42' }));
    await fixture.whenStable();
    let opened = 0;
    fixture.componentInstance.opened.subscribe(() => (opened += 1));

    fixture.debugElement.query(By.css('.card-check')).triggerEventHandler('click', new MouseEvent('click'));

    expect(TestBed.inject(NoteSelectionStore).checkedIds().has('note-42')).toBe(true);
    expect(opened).toBe(0);
  });

  describe('{{fields}}', () => {
    it('offers the form instead of a copy, which would paste the raw snippet', async () => {
      fixture.componentRef.setInput(
        'note',
        createNote({ id: 'note-42', placeholders: [{ name: 'host', defaultValue: '', value: '' }] }),
      );
      await fixture.whenStable();
      const openFor = vi.spyOn(TestBed.inject(PlaceholderFillStore), 'openFor');

      expect(fixture.debugElement.query(By.directive(CopyButtonComponent))).toBeNull();
      fixture.debugElement.query(By.css('.card-fill')).triggerEventHandler('click', new MouseEvent('click'));

      expect(openFor).toHaveBeenCalledWith('note-42');
    });

    it('falls back to a plain copy button for a note without fields', () => {
      expect(fixture.debugElement.query(By.css('.card-fill'))).toBeNull();
      expect(fixture.debugElement.query(By.directive(CopyButtonComponent))).not.toBeNull();
    });
  });

  describe('actions menu', () => {
    function menu(): NoteCardMenuComponent {
      return fixture.debugElement.query(By.directive(NoteCardMenuComponent))
        .componentInstance as NoteCardMenuComponent;
    }

    it('hands the menu the note space so it can be excluded from the targets', async () => {
      fixture.componentRef.setInput('note', createNote({ spaceId: 'work' }));
      await vi.waitFor(() => expect(menu().spaces()).toEqual(SPACES));

      expect(menu().currentSpaceId()).toBe('work');
    });

    it('gives the menu the placeholder title the card itself shows', async () => {
      fixture.componentRef.setInput('note', createNote({ title: '' }));
      await fixture.whenStable();

      expect(menu().noteTitle()).toBe('Sans titre');
    });

    it('attaches the note id to a move, which the menu does not know', async () => {
      fixture.componentRef.setInput('note', createNote({ id: 'note-42', spaceId: 'work' }));
      await fixture.whenStable();
      const moveNote = vi.spyOn(TestBed.inject(NotesStore), 'moveNote').mockResolvedValue();

      menu().moveRequested.emit('personal');

      expect(moveNote).toHaveBeenCalledWith('note-42', 'personal');
    });

    it('attaches the note id to a deletion', async () => {
      fixture.componentRef.setInput('note', createNote({ id: 'note-42' }));
      await fixture.whenStable();
      const deleteNote = vi.spyOn(TestBed.inject(NotesStore), 'deleteNote').mockResolvedValue();

      menu().deleteRequested.emit();

      expect(deleteNote).toHaveBeenCalledWith('note-42');
    });
  });

  describe('a checklist note', () => {
    const checklist = (items: { text: string; done: boolean }[], overrides = {}) =>
      createNote({ id: 'note-42', kind: 'checklist', content: '', items, ...overrides });

    beforeEach(async () => {
      fixture.componentRef.setInput(
        'note',
        checklist([
          { text: 'Relire', done: true },
          { text: 'Déployer', done: false },
        ]),
      );
      await fixture.whenStable();
    });

    it('shows the progress graphically and as text, since colour alone says nothing', () => {
      const fill = fixture.nativeElement.querySelector('.progress-fill') as HTMLElement;

      expect(fill.style.width).toBe('50%');
      expect(text('.progress-count')).toBe('1/2');
    });

    it('renders the items with their state', () => {
      const items = fixture.nativeElement.querySelectorAll('.card-item');

      expect(items).toHaveLength(2);
      expect(items[0].getAttribute('aria-checked')).toBe('true');
      expect(items[1].getAttribute('aria-checked')).toBe('false');
    });

    it('counts the items it could not fit rather than dropping them silently', async () => {
      fixture.componentRef.setInput(
        'note',
        checklist([1, 2, 3, 4, 5].map((n) => ({ text: `t${n}`, done: false }))),
      );
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelectorAll('.card-item')).toHaveLength(2);
      expect(text('.card-items-more')).toBe('+3 autre(s)');
    });

    it('shows no language badge, a checklist having no format to announce', () => {
      expect(fixture.debugElement.query(By.directive(LanguageBadgeComponent))).toBeNull();
    });

    it('saves the whole list with the ticked item flipped', () => {
      const setChecklist = vi.spyOn(TestBed.inject(NotesStore), 'setChecklist').mockResolvedValue();

      fixture.nativeElement.querySelectorAll('.card-item')[1].click();

      expect(setChecklist).toHaveBeenCalledWith('note-42', [
        { text: 'Relire', done: true },
        { text: 'Déployer', done: true },
      ]);
    });

    it('does not open the note when a box is ticked', () => {
      const opened: NoteActivation[] = [];
      fixture.componentInstance.opened.subscribe((activation) => opened.push(activation));

      fixture.nativeElement.querySelector('.card-item').click();

      expect(opened).toEqual([]);
    });

    it('hands the copy button a markdown rendering, the note having no content', () => {
      const copy = fixture.debugElement.query(By.directive(CopyButtonComponent))
        .componentInstance as CopyButtonComponent;

      expect(copy.value()).toBe(['- [x] Relire', '- [ ] Déployer'].join(NEWLINE));
    });

    it('shows no code viewer, a checklist having no body to colour', () => {
      expect(fixture.nativeElement.querySelector('.card-snippet')).toBeNull();
    });
  });
});
