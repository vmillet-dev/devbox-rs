import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesService } from '@core/preferences/preferences.service';
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

  function bodyEditor(): HTMLTextAreaElement {
    return fixture.nativeElement.querySelector('.overlay-body-editor');
  }

  function codeViewer(): CodeViewerComponent {
    return fixture.debugElement.query(By.directive(CodeViewerComponent))
      .componentInstance as CodeViewerComponent;
  }

  function toolbarButton(selector: string): HTMLButtonElement {
    return fixture.nativeElement.querySelector(selector);
  }

  function fullscreenButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.icon-btn:not(.close-btn)');
  }

  function text(selector: string): string {
    return fixture.nativeElement.querySelector(selector).textContent.replace(/\s+/g, ' ').trim();
  }

  async function type(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
    element.value = value;
    element.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  function createOverlay(): void {
    fixture = TestBed.createComponent(NoteEditorOverlayComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.autoDetectChanges();
  }

  /**
   * The seam the fullscreen preference goes through. TestBed hands out a fresh
   * instance per test, so nothing leaks between them; `recreateOverlay` keeps
   * the same one, which is exactly what "stored in a previous session" means here.
   */
  function preferences(): PreferencesService {
    return TestBed.inject(PreferencesService);
  }

  /** Rebuilds the overlay so a preference seeded in storage is read at construction. */
  function recreateOverlay(): void {
    fixture.nativeElement.remove();
    fixture.destroy();
    createOverlay();
  }

  beforeEach(() => {
    // Only virtualize `Date`; Angular's zoneless scheduler relies on real rAF/setTimeout for `whenStable()` to resolve.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));

    TestBed.configureTestingModule({
      imports: [NoteEditorOverlayComponent],
      providers: [provideAppTesting()],
    });
    createOverlay();
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

  it('invites the user to write when the note is empty', async () => {
    // An empty body looks like a rendering bug rather than an empty note.
    fixture.componentRef.setInput('note', createNote({ content: '' }));
    await fixture.whenStable();

    expect(bodyEditor().placeholder).toBe('Commencer à écrire…');
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

    it('labels the title field, the body and the close button', () => {
      expect(titleInput().getAttribute('aria-label')).toBe('Titre de la note');
      expect(bodyEditor().getAttribute('aria-label')).toBe('Contenu de la note');
      expect(fixture.nativeElement.querySelector('.close-btn').getAttribute('aria-label')).toBe(
        "Fermer l'éditeur",
      );
    });

    it('exposes the pin button as a toggle', () => {
      expect(toolbarButton('.toolbar-btn').getAttribute('aria-pressed')).toBe('false');
    });

    it('names the tag removal buttons after the tag they remove', async () => {
      fixture.componentRef.setInput('note', createNote({ tags: ['urgent'] }));
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelector('.tag-remove').getAttribute('aria-label')).toBe(
        'Retirer le tag urgent',
      );
    });
  });

  describe('title editing', () => {
    it('emits the new title on blur rather than on every keystroke', async () => {
      // Persisting per keystroke means one IPC round-trip per character.
      fixture.componentRef.setInput('note', createNote({ title: 'Before' }));
      await fixture.whenStable();
      const emitted: string[] = [];
      fixture.componentInstance.titleChanged.subscribe((title) => emitted.push(title));

      await type(titleInput(), 'After');
      expect(emitted).toEqual([]);

      titleInput().dispatchEvent(new Event('blur'));

      expect(emitted).toEqual(['After']);
    });

    it('stays silent when the title comes back to its original value', async () => {
      fixture.componentRef.setInput('note', createNote({ title: 'Same' }));
      await fixture.whenStable();
      let emitted = false;
      fixture.componentInstance.titleChanged.subscribe(() => (emitted = true));

      titleInput().dispatchEvent(new Event('blur'));

      expect(emitted).toBe(false);
    });

    it('resets the draft when another note is opened', async () => {
      fixture.componentRef.setInput('note', createNote({ id: 'a', title: 'First' }));
      await fixture.whenStable();
      await type(titleInput(), 'Typed but not confirmed');

      fixture.componentRef.setInput('note', createNote({ id: 'b', title: 'Second' }));
      await fixture.whenStable();

      expect(titleInput().value).toBe('Second');
    });
  });

  describe('body editing', () => {
    it('is editable straight away, without a preview to click through first', async () => {
      fixture.componentRef.setInput('note', createNote({ content: 'before' }));
      await fixture.whenStable();

      expect(bodyEditor().value).toBe('before');
    });

    it('keeps the highlighted layer in sync with the draft as the user types', async () => {
      // The whole point of the overlaid textarea: colours must not vanish mid-edit.
      fixture.componentRef.setInput('note', createNote({ content: '{"a":1}', language: 'json' }));
      await fixture.whenStable();

      await type(bodyEditor(), '{"a":2}');

      expect(codeViewer().content()).toBe('{"a":2}');
      expect(codeViewer().language()).toBe('json');
    });

    it('hides the highlighted layer from screen readers, which already read the textarea', async () => {
      fixture.componentRef.setInput('note', createNote({ content: 'x' }));
      await fixture.whenStable();

      const viewer = fixture.debugElement.query(By.directive(CodeViewerComponent));
      expect(viewer.nativeElement.getAttribute('aria-hidden')).toBe('true');
    });

    it('emits the new content on blur', async () => {
      fixture.componentRef.setInput('note', createNote({ content: 'before' }));
      await fixture.whenStable();
      const emitted: string[] = [];
      fixture.componentInstance.contentChanged.subscribe((content) => emitted.push(content));

      await type(bodyEditor(), 'after');
      expect(emitted).toEqual([]);

      bodyEditor().dispatchEvent(new Event('blur'));
      await fixture.whenStable();

      expect(emitted).toEqual(['after']);
    });

    it('updates the footer stats as the user types, before anything is saved', async () => {
      fixture.componentRef.setInput('note', createNote({ content: 'a', language: 'txt' }));
      await fixture.whenStable();

      await type(bodyEditor(), 'one\ntwo');

      expect(text('.overlay-footer span')).toBe('TXT · 2 lignes · 7 octets');
    });

    it('leaves the body on Escape instead of closing the whole overlay', async () => {
      fixture.componentRef.setInput('note', createNote({ content: 'before' }));
      await fixture.whenStable();
      let closed = false;
      const emitted: string[] = [];
      fixture.componentInstance.closed.subscribe(() => (closed = true));
      fixture.componentInstance.contentChanged.subscribe((content) => emitted.push(content));

      bodyEditor().focus();
      await type(bodyEditor(), 'after');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await fixture.whenStable();

      expect(emitted).toEqual(['after']);
      expect(closed).toBe(false);
      expect(document.activeElement).not.toBe(bodyEditor());
    });
  });

  describe('closing', () => {
    it('confirms the pending title before closing', async () => {
      // Escape, the backdrop and the close button all skip `blur`: without this
      // the last edit would be silently dropped.
      fixture.componentRef.setInput('note', createNote({ title: 'Before' }));
      await fixture.whenStable();
      const titles: string[] = [];
      fixture.componentInstance.titleChanged.subscribe((title) => titles.push(title));

      await type(titleInput(), 'After');
      fixture.debugElement.query(By.css('.close-btn')).triggerEventHandler('click');

      expect(titles).toEqual(['After']);
    });

    it('confirms the pending body before closing', async () => {
      fixture.componentRef.setInput('note', createNote({ content: 'before' }));
      await fixture.whenStable();
      const contents: string[] = [];
      fixture.componentInstance.contentChanged.subscribe((content) => contents.push(content));

      await type(bodyEditor(), 'after');
      fixture.debugElement.query(By.css('.close-btn')).triggerEventHandler('click');

      expect(contents).toEqual(['after']);
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

  describe('language', () => {
    it('lists every known language and selects the note one', async () => {
      fixture.componentRef.setInput('note', createNote({ language: 'sql' }));
      await fixture.whenStable();

      const select = fixture.nativeElement.querySelector('.overlay-language-select') as HTMLSelectElement;
      expect([...select.options].map((option) => option.value)).toEqual([
        'json',
        'js',
        'ts',
        'py',
        'sql',
        'yml',
        'toml',
        'xml',
        'html',
        'css',
        'sh',
        'md',
        'txt',
      ]);
      expect(select.value).toBe('sql');
    });

    it('emits the picked language', async () => {
      fixture.componentRef.setInput('note', createNote({ language: 'txt' }));
      await fixture.whenStable();
      let emitted: string | undefined;
      fixture.componentInstance.languageChanged.subscribe((language) => (emitted = language));

      const select = fixture.nativeElement.querySelector('.overlay-language-select') as HTMLSelectElement;
      select.value = 'json';
      select.dispatchEvent(new Event('change'));

      expect(emitted).toBe('json');
    });
  });

  describe('tags', () => {
    it('emits the tag to remove', async () => {
      fixture.componentRef.setInput('note', createNote({ tags: ['keep', 'drop'] }));
      await fixture.whenStable();
      let emitted: string | undefined;
      fixture.componentInstance.tagRemoved.subscribe((tag) => (emitted = tag));

      const removeButtons = fixture.nativeElement.querySelectorAll('.tag-remove');
      (removeButtons[1] as HTMLButtonElement).click();

      expect(emitted).toBe('drop');
    });

    it('emits the typed tag on submit and clears the field', async () => {
      fixture.componentRef.setInput('note', createNote({ tags: [] }));
      await fixture.whenStable();
      let emitted: string | undefined;
      fixture.componentInstance.tagAdded.subscribe((tag) => (emitted = tag));

      const input = fixture.nativeElement.querySelector('.tag-add-input') as HTMLInputElement;
      await type(input, 'urgent');
      input.form?.dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();

      expect(emitted).toBe('urgent');
      expect(input.value).toBe('');
    });

    it('ignores a blank tag submission', async () => {
      fixture.componentRef.setInput('note', createNote({ tags: [] }));
      await fixture.whenStable();
      let emitted = false;
      fixture.componentInstance.tagAdded.subscribe(() => (emitted = true));

      const input = fixture.nativeElement.querySelector('.tag-add-input') as HTMLInputElement;
      await type(input, '   ');
      input.form?.dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();

      expect(emitted).toBe(false);
    });
  });

  describe('pinning and deletion', () => {
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

    it('asks for confirmation before emitting a deletion', async () => {
      // A single click on a destructive action is too easy to hit by accident,
      // and a native confirm() would freeze the whole WebView.
      fixture.componentRef.setInput('note', createNote());
      await fixture.whenStable();
      let emitted = false;
      fixture.componentInstance.deleteRequested.subscribe(() => (emitted = true));

      toolbarButton('.delete-btn').click();
      await fixture.whenStable();

      expect(emitted).toBe(false);
      expect(text('.delete-btn')).toBe('🗑 Confirmer ?');

      toolbarButton('.delete-btn').click();

      expect(emitted).toBe(true);
    });

    it('drops the pending confirmation when another note is opened', async () => {
      fixture.componentRef.setInput('note', createNote({ id: 'a' }));
      await fixture.whenStable();
      toolbarButton('.delete-btn').click();
      await fixture.whenStable();

      fixture.componentRef.setInput('note', createNote({ id: 'b' }));
      await fixture.whenStable();

      expect(text('.delete-btn')).toBe('🗑 Supprimer');
    });
  });

  describe('expiry', () => {
    function expiryInput(): HTMLInputElement {
      return fixture.nativeElement.querySelector('.overlay-expiry-input');
    }

    async function pick(value: string): Promise<void> {
      expiryInput().value = value;
      expiryInput().dispatchEvent(new Event('change'));
      await fixture.whenStable();
    }

    it('is empty for a permanent note', async () => {
      fixture.componentRef.setInput('note', createNote({ lifecycle: { kind: 'permanent' } }));
      await fixture.whenStable();

      expect(expiryInput().value).toBe('');
    });

    it('shows an existing deadline in the local timezone', async () => {
      // Built from local parts on purpose: a UTC-based conversion would show
      // the previous day west of Greenwich.
      const at = new Date(2026, 7, 1, 23, 59, 59, 999);
      fixture.componentRef.setInput('note', createNote({ lifecycle: { kind: 'expires', at } }));
      await fixture.whenStable();

      expect(expiryInput().value).toBe('2026-08-01');
    });

    it('emits a deadline at the end of the chosen local day', async () => {
      const emitted: { kind: string; at?: Date }[] = [];
      fixture.componentInstance.lifecycleChanged.subscribe((lifecycle) => emitted.push(lifecycle));
      fixture.componentRef.setInput('note', createNote());
      await fixture.whenStable();

      await pick('2026-08-01');

      // Midnight would make a note dated today already expired the moment it
      // is set; the end of the day is what the user means by "until then".
      expect(emitted).toHaveLength(1);
      expect(emitted[0].kind).toBe('expires');
      expect(emitted[0].at).toEqual(new Date(2026, 7, 1, 23, 59, 59, 999));
    });

    it('makes the note permanent again when the field is cleared', async () => {
      const emitted: { kind: string }[] = [];
      fixture.componentInstance.lifecycleChanged.subscribe((lifecycle) => emitted.push(lifecycle));
      fixture.componentRef.setInput(
        'note',
        createNote({
          lifecycle: { kind: 'expires', at: new Date(2026, 7, 1) },
        }),
      );
      await fixture.whenStable();

      await pick('');

      expect(emitted).toEqual([{ kind: 'permanent' }]);
    });

    it('ignores an unparseable value rather than emitting an invalid date', async () => {
      const emitted: unknown[] = [];
      fixture.componentInstance.lifecycleChanged.subscribe(() => emitted.push(true));
      fixture.componentRef.setInput('note', createNote());
      await fixture.whenStable();

      // Driven through the handler and not the field: a date input sanitizes
      // anything malformed to "", so the guard is unreachable from the DOM. It
      // still matters — an `Invalid Date` would only blow up later, at the
      // serialisation boundary, with no field name attached.
      (fixture.componentInstance as unknown as { onExpiryChange: (v: string) => void }).onExpiryChange(
        'pas-une-date',
      );
      await fixture.whenStable();

      expect(emitted).toEqual([]);
    });

    it('is labelled, since a bare date field says nothing about what it sets', async () => {
      fixture.componentRef.setInput('note', createNote());
      await fixture.whenStable();

      expect(expiryInput().getAttribute('aria-label')).toBe('Échéance de la note (vide = permanente)');
    });
  });

  describe('fullscreen', () => {
    function panel(): HTMLElement {
      return fixture.nativeElement.querySelector('.overlay-panel');
    }

    async function openNote(): Promise<void> {
      fixture.componentRef.setInput('note', createNote());
      await fixture.whenStable();
    }

    beforeEach(openNote);

    it('opens at the panel default size and exposes the button as a toggle', () => {
      expect(panel().classList.contains('fullscreen')).toBe(false);
      expect(fullscreenButton().getAttribute('aria-pressed')).toBe('false');
      expect(fullscreenButton().getAttribute('aria-label')).toBe('Passer en plein écran');
    });

    it('expands the panel and flips the toggle when the button is clicked', async () => {
      fullscreenButton().click();
      await fixture.whenStable();

      expect(panel().classList.contains('fullscreen')).toBe(true);
      expect(fullscreenButton().getAttribute('aria-pressed')).toBe('true');
      expect(fullscreenButton().getAttribute('aria-label')).toBe('Quitter le plein écran');
    });

    it('returns to the default size on a second click', async () => {
      fullscreenButton().click();
      await fixture.whenStable();
      fullscreenButton().click();
      await fixture.whenStable();

      expect(panel().classList.contains('fullscreen')).toBe(false);
    });

    it('keeps the choice while another note is opened', async () => {
      // A display preference, not note state: switching notes must not reset it.
      fullscreenButton().click();
      await fixture.whenStable();

      fixture.componentRef.setInput('note', createNote({ id: 'other' }));
      await fixture.whenStable();

      expect(panel().classList.contains('fullscreen')).toBe(true);
    });

    it('persists the choice so it survives a restart', async () => {
      fullscreenButton().click();
      await fixture.whenStable();

      expect(preferences().read('devbox.editorFullscreen')).toBe('true');
    });

    it('reopens fullscreen when the preference was stored in a previous session', async () => {
      preferences().write('devbox.editorFullscreen', 'true');
      recreateOverlay();
      await openNote();

      expect(panel().classList.contains('fullscreen')).toBe(true);
    });

    it('ignores an invalid persisted value', async () => {
      preferences().write('devbox.editorFullscreen', 'oui');
      recreateOverlay();
      await openNote();

      expect(panel().classList.contains('fullscreen')).toBe(false);
    });
  });
});
