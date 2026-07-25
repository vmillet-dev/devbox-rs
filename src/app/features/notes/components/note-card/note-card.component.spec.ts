import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNote } from '../../../../../testing/note.fixture';
import { provideTranslocoTesting } from '../../../../../testing/provide-transloco-testing';
import { LanguageBadgeComponent } from '../../../../shared/ui/language-badge/language-badge.component';
import { NoteCardComponent } from './note-card.component';

describe('NoteCardComponent', () => {
  let fixture: ComponentFixture<NoteCardComponent>;

  beforeEach(() => {
    // Only virtualize `Date`; Angular's zoneless scheduler relies on real rAF/setTimeout for `whenStable()` to resolve.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));

    TestBed.configureTestingModule({ imports: [NoteCardComponent], providers: [provideTranslocoTesting()] });
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

    expect(fixture.nativeElement.querySelector('.card-title').textContent).toBe('My note');
    const badge = fixture.debugElement.query(By.directive(LanguageBadgeComponent)).componentInstance as LanguageBadgeComponent;
    expect(badge.language()).toBe('json');
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

    expect(fixture.nativeElement.querySelector('.card-footer span').textContent).toBe('expire dans 3j');
  });

  it('marks the footer as stale when the note is expiring soon', async () => {
    fixture.componentRef.setInput(
      'note',
      createNote({ lifecycle: { kind: 'expires', at: new Date('2026-01-11T12:00:00Z') } }),
    );
    await fixture.whenStable();

    const footerLabel = fixture.debugElement.query(By.css('.card-footer span'));
    expect(footerLabel.classes['stale']).toBe(true);
  });

  it('shows the source prefix in the footer for a pinned, non-expiring note', async () => {
    fixture.componentRef.setInput(
      'note',
      createNote({ pinned: true, source: 'API Gateway / Auth', lifecycle: { kind: 'permanent' } }),
    );
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.card-footer span').textContent).toBe('API Gateway');
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

    expect(fixture.nativeElement.querySelector('.card-footer span').textContent).toBe('il y a 1h');
  });

  it('applies the pinned and selected classes based on inputs', async () => {
    fixture.componentRef.setInput('note', createNote({ pinned: true }));
    fixture.componentRef.setInput('selected', true);
    await fixture.whenStable();

    const card = fixture.debugElement.query(By.css('.card'));
    expect(card.classes['pinned']).toBe(true);
    expect(card.classes['selected']).toBe(true);
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
