import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { createNote } from '../../../../../testing/note.fixture';
import { provideTranslocoTesting } from '../../../../../testing/provide-transloco-testing';
import { NoteCardComponent } from '../note-card/note-card.component';
import { NoteSectionComponent } from './note-section.component';

describe('NoteSectionComponent', () => {
  let fixture: ComponentFixture<NoteSectionComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [NoteSectionComponent], providers: [provideTranslocoTesting()] });
    fixture = TestBed.createComponent(NoteSectionComponent);
    fixture.componentRef.setInput('section', { key: 'today', title: "Aujourd'hui", notes: [] });
    fixture.autoDetectChanges();
  });

  it('renders the section title and note count', async () => {
    fixture.componentRef.setInput('section', {
      key: 'today',
      title: "Aujourd'hui",
      notes: [createNote(), createNote({ id: '2' })],
    });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.canvas-section-title').textContent).toContain("Aujourd'hui");
    expect(fixture.nativeElement.querySelector('.n').textContent.trim()).toBe('· 2');
  });

  it('appends the hint to the count when present', async () => {
    fixture.componentRef.setInput('section', { key: 'week', title: 'Cette semaine', notes: [], hint: 'à trier bientôt' });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.n').textContent.trim()).toBe('· 0 · à trier bientôt');
  });

  it('renders one note card per note, forwarding the selected state', async () => {
    const notes = [createNote({ id: 'a' }), createNote({ id: 'b' })];
    fixture.componentRef.setInput('section', { key: 'today', title: "Aujourd'hui", notes });
    fixture.componentRef.setInput('selectedNoteId', 'b');
    await fixture.whenStable();

    const cards = fixture.debugElement.queryAll(By.directive(NoteCardComponent));
    const instances = cards.map((card) => card.componentInstance as NoteCardComponent);
    expect(instances.map((card) => card.note().id)).toEqual(['a', 'b']);
    expect(instances.map((card) => card.selected())).toEqual([false, true]);
  });

  it('forwards the opened event from a note card as noteOpened', async () => {
    fixture.componentRef.setInput('section', { key: 'today', title: "Aujourd'hui", notes: [createNote({ id: 'a' })] });
    await fixture.whenStable();
    let emitted: string | undefined;
    fixture.componentInstance.noteOpened.subscribe((id) => (emitted = id));

    const card = fixture.debugElement.query(By.directive(NoteCardComponent)).componentInstance as NoteCardComponent;
    card.opened.emit('a');

    expect(emitted).toBe('a');
  });

  it('does not show the create-ghost button unless requested by the section', () => {
    expect(fixture.debugElement.query(By.css('.ghost'))).toBeNull();
  });

  it('emits createRequested when the create-ghost button is clicked', async () => {
    fixture.componentRef.setInput('section', { key: 'week', title: 'Cette semaine', notes: [], showCreateGhost: true });
    await fixture.whenStable();
    let emitted = false;
    fixture.componentInstance.createRequested.subscribe(() => (emitted = true));

    fixture.debugElement.query(By.css('.ghost')).triggerEventHandler('click');

    expect(emitted).toBe(true);
  });
});
