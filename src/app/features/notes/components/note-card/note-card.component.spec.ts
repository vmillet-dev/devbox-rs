import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageBadgeComponent } from '@shared/ui/language-badge/language-badge.component';
import { createNote } from '@testing/note.fixture';
import { provideAppTesting } from '@testing/testing.providers';
import { NoteCardComponent } from './note-card.component';

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

    expect(fixture.nativeElement.querySelector('.card-snippet').textContent).toBe('one\ntwo\nthree');
  });

  it('shows at most 2 tags', async () => {
    fixture.componentRef.setInput('note', createNote({ tags: ['a', 'b', 'c'] }));
    await fixture.whenStable();

    const tags = fixture.debugElement.queryAll(By.css('.card-tags span'));
    expect(tags.map((tag) => tag.nativeElement.textContent)).toEqual(['#a', '#b']);
  });

  it('shows the expiry countdown in the footer for an expiring note', async () => {
    fixture.componentRef.setInput(
      'note',
      createNote({ lifecycle: { kind: 'expires', at: new Date('2026-01-13T12:00:00Z') } }),
    );
    await fixture.whenStable();

    expect(text('.card-footer span')).toBe('expire dans 3j');
  });

  it('marks the footer as stale when the note is expiring soon', async () => {
    fixture.componentRef.setInput(
      'note',
      createNote({ lifecycle: { kind: 'expires', at: new Date('2026-01-11T12:00:00Z') } }),
    );
    await fixture.whenStable();

    expect(fixture.debugElement.query(By.css('.card-footer span')).classes['stale']).toBe(true);
  });

  it('shows the source prefix in the footer for a pinned, non-expiring note', async () => {
    fixture.componentRef.setInput(
      'note',
      createNote({ pinned: true, source: 'API Gateway / Auth', lifecycle: { kind: 'permanent' } }),
    );
    await fixture.whenStable();

    expect(text('.card-footer span')).toBe('API Gateway');
  });

  it('falls back to the relative time for a pinned note that has no source', async () => {
    fixture.componentRef.setInput(
      'note',
      createNote({ pinned: true, source: '', updatedAt: new Date('2026-01-10T11:00:00Z') }),
    );
    await fixture.whenStable();

    expect(text('.card-footer span')).toBe('il y a 1h');
  });

  it('shows the relative update time in the footer for an unpinned, non-expiring note', async () => {
    fixture.componentRef.setInput(
      'note',
      createNote({
        pinned: false,
        lifecycle: { kind: 'permanent' },
        updatedAt: new Date('2026-01-10T11:00:00Z'),
      }),
    );
    await fixture.whenStable();

    expect(text('.card-footer span')).toBe('il y a 1h');
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
});
