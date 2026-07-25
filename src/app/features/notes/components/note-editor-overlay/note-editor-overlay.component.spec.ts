import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeViewerComponent } from '@shared/ui/code-viewer/code-viewer.component';
import { LifecycleBadgeComponent } from '@shared/ui/lifecycle-badge/lifecycle-badge.component';
import { TagPillComponent } from '@shared/ui/tag-pill/tag-pill.component';
import { createNote } from '@testing/note.fixture';
import { provideAppTesting } from '@testing/testing.providers';
import { NoteEditorOverlayComponent } from './note-editor-overlay.component';

describe('NoteEditorOverlayComponent', () => {
  let fixture: ComponentFixture<NoteEditorOverlayComponent>;

  function titleInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('.overlay-title-input');
  }

  function text(selector: string): string {
    return fixture.nativeElement.querySelector(selector).textContent.replace(/\s+/g, ' ').trim();
  }

  beforeEach(() => {
    // Only virtualize `Date`; Angular's zoneless scheduler relies on real rAF/setTimeout for `whenStable()` to resolve.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));

    TestBed.configureTestingModule({
      imports: [NoteEditorOverlayComponent],
      providers: [provideAppTesting()],
    });
    fixture = TestBed.createComponent(NoteEditorOverlayComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.autoDetectChanges();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
    vi.useRealTimers();
  });

  it('renders nothing when there is no note', () => {
    expect(fixture.debugElement.query(By.css('.overlay-backdrop'))).toBeNull();
  });

  it('falls back to sensible defaults for the footer computed values when there is no note', () => {
    const instance = fixture.componentInstance as unknown as {
      languageLabel: () => string;
      lineCount: () => number;
      byteSize: () => number;
    };

    expect(instance.languageLabel()).toBe('TXT');
    expect(instance.lineCount()).toBe(0);
    expect(instance.byteSize()).toBe(0);
  });

  it('renders the note title, tags, lifecycle and code content', async () => {
    const note = createNote({
      title: 'My note',
      tags: ['a', 'b'],
      content: '{"x":1}',
      language: 'json',
      lifecycle: { kind: 'permanent' },
    });
    fixture.componentRef.setInput('note', note);
    await fixture.whenStable();

    expect(titleInput().value).toBe('My note');

    const pills = fixture.debugElement
      .queryAll(By.directive(TagPillComponent))
      .map((pill) => pill.componentInstance as TagPillComponent);
    expect(pills.map((pill) => pill.label())).toEqual(['a', 'b']);
    expect(pills.every((pill) => pill.active() && !pill.interactive())).toBe(true);

    const badge = fixture.debugElement.query(By.directive(LifecycleBadgeComponent))
      .componentInstance as LifecycleBadgeComponent;
    expect(badge.lifecycle()).toEqual({ kind: 'permanent' });

    const viewer = fixture.debugElement.query(By.directive(CodeViewerComponent))
      .componentInstance as CodeViewerComponent;
    expect(viewer.content()).toBe('{"x":1}');
    expect(viewer.language()).toBe('json');
  });

  it('computes the language label, line count and byte size in the footer', async () => {
    fixture.componentRef.setInput('note', createNote({ content: 'line one\nline two', language: 'js' }));
    await fixture.whenStable();

    expect(text('.overlay-footer span')).toBe('JS · 2 lignes · 17 octets');
  });

  describe('accessibility', () => {
    beforeEach(async () => {
      fixture.componentRef.setInput('note', createNote({ title: 'My note' }));
      await fixture.whenStable();
    });

    it('declares itself a modal dialog named by its title field', () => {
      const panel = fixture.nativeElement.querySelector('.overlay-panel');

      expect(panel.getAttribute('role')).toBe('dialog');
      expect(panel.getAttribute('aria-modal')).toBe('true');
      expect(panel.getAttribute('aria-labelledby')).toBe(titleInput().id);
    });

    it('moves focus into the dialog when it opens', () => {
      // Otherwise focus stays on the card behind and Tab wanders through
      // content hidden by the overlay.
      expect(fixture.nativeElement.querySelector('.overlay-panel').contains(document.activeElement)).toBe(
        true,
      );
    });

    it('labels the title field and the close button', () => {
      expect(titleInput().getAttribute('aria-label')).toBe('Titre de la note');
      expect(fixture.nativeElement.querySelector('.close-btn').getAttribute('aria-label')).toBe(
        "Fermer l'éditeur",
      );
    });

    it('exposes the pin button as a toggle', () => {
      expect(fixture.nativeElement.querySelector('.toolbar-btn').getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('emits titleChanged on every keystroke, not only on blur', async () => {
    // The overlay closes on Escape and on backdrop click — neither blurs the
    // field, so a (change)-only binding silently dropped the edit.
    fixture.componentRef.setInput('note', createNote());
    await fixture.whenStable();
    const emitted: string[] = [];
    fixture.componentInstance.titleChanged.subscribe((title) => emitted.push(title));

    titleInput().value = 'Renamed';
    titleInput().dispatchEvent(new Event('input'));

    expect(emitted).toEqual(['Renamed']);
  });

  it('emits pinToggled when the pin button is clicked, and reflects the pinned state', async () => {
    fixture.componentRef.setInput('note', createNote({ pinned: false }));
    await fixture.whenStable();
    let emitted = false;
    fixture.componentInstance.pinToggled.subscribe(() => (emitted = true));

    const pinButton = fixture.debugElement.query(By.css('.toolbar-btn'));
    expect(text('.toolbar-btn')).toBe('📌 Épingler');
    expect(pinButton.classes['pinned']).toBeFalsy();

    pinButton.triggerEventHandler('click');

    expect(emitted).toBe(true);
  });

  it('shows the pinned label and class when the note is pinned', async () => {
    fixture.componentRef.setInput('note', createNote({ pinned: true }));
    await fixture.whenStable();

    expect(text('.toolbar-btn')).toBe('📌 Épinglée');
    expect(fixture.debugElement.query(By.css('.toolbar-btn')).classes['pinned']).toBe(true);
  });

  it('emits closed when the close button is clicked', async () => {
    fixture.componentRef.setInput('note', createNote());
    await fixture.whenStable();
    let emitted = false;
    fixture.componentInstance.closed.subscribe(() => (emitted = true));

    fixture.debugElement.query(By.css('.close-btn')).triggerEventHandler('click');

    expect(emitted).toBe(true);
  });

  it('emits closed when Escape is pressed while a note is open', async () => {
    fixture.componentRef.setInput('note', createNote());
    await fixture.whenStable();
    let emitted = false;
    fixture.componentInstance.closed.subscribe(() => (emitted = true));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(emitted).toBe(true);
  });

  it('does not emit closed on Escape when there is no note open', () => {
    let emitted = false;
    fixture.componentInstance.closed.subscribe(() => (emitted = true));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(emitted).toBe(false);
  });

  it('emits closed when clicking directly on the backdrop', async () => {
    fixture.componentRef.setInput('note', createNote());
    await fixture.whenStable();
    let emitted = false;
    fixture.componentInstance.closed.subscribe(() => (emitted = true));

    fixture.nativeElement
      .querySelector('.overlay-backdrop')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(emitted).toBe(true);
  });

  it('does not emit closed when clicking inside the panel', async () => {
    fixture.componentRef.setInput('note', createNote());
    await fixture.whenStable();
    let emitted = false;
    fixture.componentInstance.closed.subscribe(() => (emitted = true));

    fixture.nativeElement
      .querySelector('.overlay-panel')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(emitted).toBe(false);
  });
});
