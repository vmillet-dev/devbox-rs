import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNote } from '../../../../../testing/note.fixture';
import { CodeViewerComponent } from '../code-viewer/code-viewer.component';
import { TagPillComponent } from '../../../../shared/ui/tag-pill/tag-pill.component';
import { LifecycleBadgeComponent } from '../../../../shared/ui/lifecycle-badge/lifecycle-badge.component';
import { NoteEditorOverlayComponent } from './note-editor-overlay.component';

describe('NoteEditorOverlayComponent', () => {
  let fixture: ComponentFixture<NoteEditorOverlayComponent>;

  beforeEach(() => {
    // Only virtualize `Date`; Angular's zoneless scheduler relies on real rAF/setTimeout for `whenStable()` to resolve.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));

    TestBed.configureTestingModule({ imports: [NoteEditorOverlayComponent] });
    fixture = TestBed.createComponent(NoteEditorOverlayComponent);
    fixture.autoDetectChanges();
  });

  afterEach(() => {
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

    const titleInput: HTMLInputElement = fixture.nativeElement.querySelector('.overlay-title-input');
    expect(titleInput.value).toBe('My note');

    const pills = fixture.debugElement.queryAll(By.directive(TagPillComponent));
    const pillInstances = pills.map((pill) => pill.componentInstance as TagPillComponent);
    expect(pillInstances.map((pill) => pill.label())).toEqual(['a', 'b']);
    expect(pillInstances.every((pill) => pill.active() === true && pill.interactive() === false)).toBe(true);

    const badge = fixture.debugElement.query(By.directive(LifecycleBadgeComponent)).componentInstance as LifecycleBadgeComponent;
    expect(badge.lifecycle()).toEqual({ kind: 'permanent' });

    const viewer = fixture.debugElement.query(By.directive(CodeViewerComponent)).componentInstance as CodeViewerComponent;
    expect(viewer.content()).toBe('{"x":1}');
    expect(viewer.language()).toBe('json');
  });

  it('computes the language label, line count and byte size in the footer', async () => {
    const note = createNote({ content: 'line one\nline two', language: 'js' });
    fixture.componentRef.setInput('note', note);
    await fixture.whenStable();

    const footerFirstLine = fixture.nativeElement.querySelectorAll('.overlay-footer span')[0].textContent;
    expect(footerFirstLine).toBe('JS · 2 lignes · 17 octets');
  });

  it('emits titleChanged with the new value when the title input changes', async () => {
    fixture.componentRef.setInput('note', createNote());
    await fixture.whenStable();
    let emitted: string | undefined;
    fixture.componentInstance.titleChanged.subscribe((title) => (emitted = title));

    const titleInput: HTMLInputElement = fixture.nativeElement.querySelector('.overlay-title-input');
    titleInput.value = 'Renamed';
    titleInput.dispatchEvent(new Event('change'));

    expect(emitted).toBe('Renamed');
  });

  it('emits pinToggled when the pin button is clicked, and reflects the pinned state', async () => {
    fixture.componentRef.setInput('note', createNote({ pinned: false }));
    await fixture.whenStable();
    let emitted = false;
    fixture.componentInstance.pinToggled.subscribe(() => (emitted = true));

    const pinButton = fixture.debugElement.query(By.css('.toolbar-btn'));
    expect(pinButton.nativeElement.textContent.trim()).toBe('📌 Épingler');
    expect(pinButton.classes['pinned']).toBeFalsy();

    pinButton.triggerEventHandler('click');

    expect(emitted).toBe(true);
  });

  it('shows the pinned label and class when the note is pinned', async () => {
    fixture.componentRef.setInput('note', createNote({ pinned: true }));
    await fixture.whenStable();

    const pinButton = fixture.debugElement.query(By.css('.toolbar-btn'));
    expect(pinButton.nativeElement.textContent.trim()).toBe('📌 Épinglée');
    expect(pinButton.classes['pinned']).toBe(true);
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

    const backdrop = fixture.nativeElement.querySelector('.overlay-backdrop');
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(emitted).toBe(true);
  });

  it('does not emit closed when clicking inside the panel', async () => {
    fixture.componentRef.setInput('note', createNote());
    await fixture.whenStable();
    let emitted = false;
    fixture.componentInstance.closed.subscribe(() => (emitted = true));

    const panel = fixture.nativeElement.querySelector('.overlay-panel');
    panel.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(emitted).toBe(false);
  });
});
