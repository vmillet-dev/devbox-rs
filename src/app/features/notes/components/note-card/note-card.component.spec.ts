import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Space } from '@core/models/space.model';
import { LanguageBadgeComponent } from '@shared/ui/language-badge/language-badge.component';
import { createNote } from '@testing/note.fixture';
import { provideAppTesting } from '@testing/testing.providers';
import { NoteCardMenuComponent } from '../note-card-menu/note-card-menu.component';
import { NoteCardComponent, NoteMove } from './note-card.component';

describe('NoteCardComponent', () => {
  let fixture: ComponentFixture<NoteCardComponent>;

  function text(selector: string): string {
    return fixture.nativeElement.querySelector(selector).textContent.replace(/\s+/g, ' ').trim();
  }

  beforeEach(() => {
    // Only virtualize `Date`; Angular's zoneless scheduler relies on real rAF/setTimeout for `whenStable()` to resolve.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));

    TestBed.configureTestingModule({ imports: [NoteCardComponent], providers: [provideAppTesting()] });
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
    // A freshly created note has no title; storing "Nouvelle note" in the data
    // would freeze French into the database.
    fixture.componentRef.setInput('note', createNote({ title: '' }));
    await fixture.whenStable();

    expect(text('.card-title')).toBe('Sans titre');
  });

  it('shows only the first 3 lines of content as a snippet', async () => {
    fixture.componentRef.setInput('note', createNote({ content: 'one\ntwo\nthree\nfour' }));
    await fixture.whenStable();

    // The snippet goes through the code viewer, which renders one element per
    // line rather than a single text node.
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

    // A gutter on a three-line excerpt is noise, and it would eat into the width.
    expect(fixture.debugElement.queryAll(By.css('.card-snippet .line-no'))).toHaveLength(0);
  });

  it('shows at most 2 tags', async () => {
    fixture.componentRef.setInput('note', createNote({ tags: ['a', 'b', 'c'] }));
    await fixture.whenStable();

    const tags = fixture.debugElement.queryAll(By.css('.card-tags span'));
    expect(tags.map((tag) => tag.nativeElement.textContent)).toEqual(['#a', '#b']);
  });

  /**
   * Which footer a note gets is decided in Rust (`domain::display`) and tested
   * there. What is left here is rendering the variant that arrives — including
   * formatting the dated ones locally, so the label keeps ageing on screen
   * without another round trip.
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

  it('applies the pinned and selected classes based on inputs', async () => {
    fixture.componentRef.setInput('note', createNote({ pinned: true }));
    fixture.componentRef.setInput('selected', true);
    await fixture.whenStable();

    const card = fixture.debugElement.query(By.css('.card'));
    expect(card.classes['pinned']).toBe(true);
    expect(card.classes['selected']).toBe(true);
  });

  it('keeps the card button free of flow content, which a <button> may not contain', () => {
    // Nested <div> inside a <button> is invalid HTML with undefined
    // accessibility behaviour across browsers.
    expect(fixture.nativeElement.querySelectorAll('button div')).toHaveLength(0);
  });

  it('emits opened with the note id when clicked', async () => {
    fixture.componentRef.setInput('note', createNote({ id: 'note-42' }));
    await fixture.whenStable();
    let emitted: string | undefined;
    fixture.componentInstance.opened.subscribe((id) => (emitted = id));

    fixture.debugElement.query(By.css('.card')).triggerEventHandler('click');

    expect(emitted).toBe('note-42');
  });

  describe('actions menu', () => {
    function menu(): NoteCardMenuComponent {
      return fixture.debugElement.query(By.directive(NoteCardMenuComponent))
        .componentInstance as NoteCardMenuComponent;
    }

    it('hands the menu the note space so it can be excluded from the targets', async () => {
      const spaces: Space[] = [
        { id: 'work', name: 'Work' },
        { id: 'personal', name: 'Personal' },
      ];
      fixture.componentRef.setInput('note', createNote({ spaceId: 'work' }));
      fixture.componentRef.setInput('spaces', spaces);
      await fixture.whenStable();

      expect(menu().currentSpaceId()).toBe('work');
      expect(menu().spaces()).toEqual(spaces);
    });

    it('gives the menu the placeholder title the card itself shows', async () => {
      // Resolving it once here keeps the untitled rule in a single place.
      fixture.componentRef.setInput('note', createNote({ title: '' }));
      await fixture.whenStable();

      expect(menu().noteTitle()).toBe('Sans titre');
    });

    it('attaches the note id to a move, which the menu does not know', async () => {
      fixture.componentRef.setInput('note', createNote({ id: 'note-42', spaceId: 'work' }));
      await fixture.whenStable();
      const moves: NoteMove[] = [];
      fixture.componentInstance.moveRequested.subscribe((move) => moves.push(move));

      menu().moveRequested.emit('personal');

      expect(moves).toEqual([{ noteId: 'note-42', spaceId: 'personal' }]);
    });

    it('attaches the note id to a deletion', async () => {
      fixture.componentRef.setInput('note', createNote({ id: 'note-42' }));
      await fixture.whenStable();
      let deleted: string | undefined;
      fixture.componentInstance.deleteRequested.subscribe((id) => (deleted = id));

      menu().deleteRequested.emit();

      expect(deleted).toBe('note-42');
    });
  });
});
