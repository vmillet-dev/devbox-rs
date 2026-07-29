import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { createNote } from '@testing/note.fixture';
import { createSection } from '@testing/section.fixture';
import { provideAppTesting } from '@testing/testing.providers';
import { NoteCardComponent } from '../note-card/note-card.component';
import { NoteSectionComponent } from './note-section.component';

describe('NoteSectionComponent', () => {
  let fixture: ComponentFixture<NoteSectionComponent>;

  function text(selector: string): string {
    return fixture.nativeElement.querySelector(selector).textContent.replace(/\s+/g, ' ').trim();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [NoteSectionComponent], providers: [provideAppTesting()] });
    fixture = TestBed.createComponent(NoteSectionComponent);
    fixture.componentRef.setInput('section', createSection('today'));
    fixture.autoDetectChanges();
  });

  it('derives the section title from its key, so no label is kept in sync by hand', async () => {
    fixture.componentRef.setInput('section', createSection('today', [createNote(), createNote({ id: '2' })]));
    await fixture.whenStable();

    expect(text('.canvas-section-title')).toContain("Aujourd'hui");
    expect(text('.n')).toBe('· 2');
  });

  it('translates every section key it can be given', async () => {
    for (const [key, expected] of [
      ['pinned', 'Épinglées'],
      ['week', 'Cette semaine'],
      ['older', 'Plus anciennes'],
      ['results', 'Résultats'],
    ] as const) {
      fixture.componentRef.setInput('section', createSection(key));
      await fixture.whenStable();

      expect(text('.canvas-section-title')).toContain(expected);
    }
  });

  it('appends the expiring hint to the count when the section holds an expiring note', async () => {
    fixture.componentRef.setInput('section', createSection('week', [], { hasExpiringNotes: true }));
    await fixture.whenStable();

    expect(text('.n')).toBe('· 0 · à trier bientôt');
  });

  it('names its region after its heading for screen-reader navigation', async () => {
    fixture.componentRef.setInput('section', createSection('pinned'));
    await fixture.whenStable();

    const section = fixture.nativeElement.querySelector('section');
    const heading = fixture.nativeElement.querySelector('h2');
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  it('renders one note card per note, forwarding the selected state', async () => {
    const notes = [createNote({ id: 'a' }), createNote({ id: 'b' })];
    fixture.componentRef.setInput('section', createSection('today', notes));
    fixture.componentRef.setInput('selectedNoteId', 'b');
    await fixture.whenStable();

    const cards = fixture.debugElement
      .queryAll(By.directive(NoteCardComponent))
      .map((card) => card.componentInstance as NoteCardComponent);

    expect(cards.map((card) => card.note().id)).toEqual(['a', 'b']);
    expect(cards.map((card) => card.selected())).toEqual([false, true]);
  });

  it('forwards the opened event from a note card as noteOpened', async () => {
    fixture.componentRef.setInput('section', createSection('today', [createNote({ id: 'a' })]));
    await fixture.whenStable();
    let emitted: string | undefined;
    fixture.componentInstance.noteOpened.subscribe((id) => (emitted = id));

    const card = fixture.debugElement.query(By.directive(NoteCardComponent))
      .componentInstance as NoteCardComponent;
    card.opened.emit('a');

    expect(emitted).toBe('a');
  });

  it('does not show the create-ghost button unless requested by the section', () => {
    expect(fixture.debugElement.query(By.css('.ghost'))).toBeNull();
  });

  it('emits createRequested when the create-ghost button is clicked', async () => {
    fixture.componentRef.setInput('section', createSection('week', [], { showCreateGhost: true }));
    await fixture.whenStable();
    let emitted = false;
    fixture.componentInstance.createRequested.subscribe(() => (emitted = true));

    fixture.debugElement.query(By.css('.ghost')).triggerEventHandler('click');

    expect(emitted).toBe(true);
  });
});
