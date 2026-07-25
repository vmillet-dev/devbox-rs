import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSection } from '@testing/section.fixture';
import { provideAppTesting } from '@testing/testing.providers';
import { NoteSectionComponent } from '../note-section/note-section.component';
import { NoteCanvasComponent } from './note-canvas.component';

describe('NoteCanvasComponent', () => {
  let fixture: ComponentFixture<NoteCanvasComponent>;

  function sections(): NoteSectionComponent[] {
    return fixture.debugElement
      .queryAll(By.directive(NoteSectionComponent))
      .map((el) => el.componentInstance as NoteSectionComponent);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [NoteCanvasComponent], providers: [provideAppTesting()] });
    fixture = TestBed.createComponent(NoteCanvasComponent);
    fixture.componentRef.setInput('sections', [
      createSection('pinned'),
      createSection('week', [], { showCreateGhost: true }),
    ]);
    fixture.autoDetectChanges();
  });

  it('renders one note-section per section, forwarding the selected note id', async () => {
    fixture.componentRef.setInput('selectedNoteId', 'note-1');
    await fixture.whenStable();

    expect(sections().map((s) => s.section().key)).toEqual(['pinned', 'week']);
    expect(sections().every((s) => s.selectedNoteId() === 'note-1')).toBe(true);
  });

  it('forwards noteOpened from a section', () => {
    let emitted: string | undefined;
    fixture.componentInstance.noteOpened.subscribe((id) => (emitted = id));

    sections()[0].noteOpened.emit('note-7');

    expect(emitted).toBe('note-7');
  });

  it('forwards createRequested from a section', () => {
    let emitted = false;
    fixture.componentInstance.createRequested.subscribe(() => (emitted = true));

    sections()[0].createRequested.emit();

    expect(emitted).toBe(true);
  });

  describe('states', () => {
    it('shows a loading message instead of the sections while loading', async () => {
      fixture.componentRef.setInput('isLoading', true);
      await fixture.whenStable();

      expect(fixture.nativeElement.textContent).toContain('Chargement des notes');
      expect(sections()).toHaveLength(0);
      expect(fixture.nativeElement.querySelector('.canvas').getAttribute('aria-busy')).toBe('true');
    });

    it('shows an empty-search message instead of an empty results section', async () => {
      fixture.componentRef.setInput('hasNoResults', true);
      await fixture.whenStable();

      expect(fixture.nativeElement.textContent).toContain('Aucune note ne correspond');
      expect(sections()).toHaveLength(0);
    });

    it('shows the load failure with its detail and offers a retry', async () => {
      // A failed load empties the whole screen, so it gets its own recovery
      // path rather than relying on the global banner alone.
      fixture.componentRef.setInput('loadError', new Error('database is locked'));
      await fixture.whenStable();

      expect(fixture.nativeElement.textContent).toContain('Impossible de charger les notes');
      expect(fixture.nativeElement.textContent).toContain('database is locked');
      expect(fixture.nativeElement.querySelector('.canvas-state').getAttribute('role')).toBe('alert');
      expect(sections()).toHaveLength(0);
    });

    it('emits reloadRequested when the retry button is clicked', async () => {
      fixture.componentRef.setInput('loadError', new Error('nope'));
      await fixture.whenStable();
      let emitted = false;
      fixture.componentInstance.reloadRequested.subscribe(() => (emitted = true));

      fixture.debugElement.query(By.css('.canvas-retry')).triggerEventHandler('click');

      expect(emitted).toBe(true);
    });

    it('prefers the error state over the loading state', async () => {
      fixture.componentRef.setInput('isLoading', true);
      fixture.componentRef.setInput('loadError', new Error('nope'));
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelector('.canvas-retry')).not.toBeNull();
    });
  });
});
