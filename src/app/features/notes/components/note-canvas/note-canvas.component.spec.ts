import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '../../../../../testing/provide-transloco-testing';
import { NoteSectionComponent } from '../note-section/note-section.component';
import { NoteCanvasComponent } from './note-canvas.component';

describe('NoteCanvasComponent', () => {
  let fixture: ComponentFixture<NoteCanvasComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [NoteCanvasComponent], providers: [provideTranslocoTesting()] });
    fixture = TestBed.createComponent(NoteCanvasComponent);
    fixture.componentRef.setInput('sections', [
      { key: 'pinned', title: 'Épinglées', notes: [] },
      { key: 'week', title: 'Cette semaine', notes: [], showCreateGhost: true },
    ]);
    fixture.autoDetectChanges();
  });

  it('renders one note-section per section, forwarding the selected note id', async () => {
    fixture.componentRef.setInput('selectedNoteId', 'note-1');
    await fixture.whenStable();

    const sections = fixture.debugElement.queryAll(By.directive(NoteSectionComponent));
    const instances = sections.map((el) => el.componentInstance as NoteSectionComponent);
    expect(instances.map((s) => s.section().key)).toEqual(['pinned', 'week']);
    expect(instances.every((s) => s.selectedNoteId() === 'note-1')).toBe(true);
  });

  it('forwards noteOpened from a section', () => {
    let emitted: string | undefined;
    fixture.componentInstance.noteOpened.subscribe((id) => (emitted = id));

    const section = fixture.debugElement.query(By.directive(NoteSectionComponent)).componentInstance as NoteSectionComponent;
    section.noteOpened.emit('note-7');

    expect(emitted).toBe('note-7');
  });

  it('forwards createRequested from a section', () => {
    let emitted = false;
    fixture.componentInstance.createRequested.subscribe(() => (emitted = true));

    const section = fixture.debugElement.query(By.directive(NoteSectionComponent)).componentInstance as NoteSectionComponent;
    section.createRequested.emit();

    expect(emitted).toBe(true);
  });
});
