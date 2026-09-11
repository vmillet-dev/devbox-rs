import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '@core/settings/settings.store';
import { ShortcutsRegistry } from '@core/shortcuts/shortcuts.registry';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { ShortcutsDialogComponent } from './shortcuts-dialog.component';

describe('ShortcutsDialogComponent', () => {
  let fixture: ComponentFixture<ShortcutsDialogComponent>;
  let registry: ShortcutsRegistry;
  let settings: SettingsStore;

  const groupTitles = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.shortcut-group-title')).map((title) =>
      (title as HTMLElement).textContent!.trim(),
    );

  /** The caps of the row whose label contains `label`, in order. */
  function keysFor(label: string): string[] {
    const labels = Array.from(fixture.nativeElement.querySelectorAll('.shortcut-label'));
    const index = labels.findIndex((entry) => (entry as HTMLElement).textContent!.includes(label));
    if (index < 0) throw new Error(`No shortcut labelled "${label}"`);

    const row = fixture.nativeElement.querySelectorAll('.shortcut-keys')[index] as HTMLElement;
    return Array.from(row.querySelectorAll('kbd')).map((key) => (key as HTMLElement).textContent!);
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ShortcutsDialogComponent],
      providers: [provideTranslocoTesting()],
    });
    registry = TestBed.inject(ShortcutsRegistry);
    settings = TestBed.inject(SettingsStore);
    fixture = TestBed.createComponent(ShortcutsDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  it('lists the global shortcuts even when no feature has contributed', async () => {
    // They are the application's own, and they work with the window closed.
    expect(groupTitles()).toEqual(['Globaux (même fenêtre fermée)']);
    expect(keysFor('palette de collage rapide')).toEqual(['Ctrl', 'Alt', 'P']);
    expect(keysFor('Capturer le presse-papier')).toEqual(['Ctrl', 'Alt', 'V']);
  });

  it('shows the quick-paste key that is really bound, not the one that shipped', async () => {
    settings.setPaletteShortcut('Ctrl+Shift+K');
    await fixture.whenStable();

    expect(keysFor('palette de collage rapide')).toEqual(['Ctrl', 'Shift', 'K']);
  });

  it('renders the contributed groups after the global one, in their declared order', async () => {
    registry.register([
      {
        id: 'notes.palette',
        labelKey: 'shortcuts.groups.palette',
        order: 30,
        shortcuts: [{ keys: ['Enter'], labelKey: 'shortcuts.palette.paste' }],
      },
      {
        id: 'notes.canvas',
        labelKey: 'shortcuts.groups.canvas',
        order: 10,
        shortcuts: [{ keys: ['Ctrl', 'K'], labelKey: 'shortcuts.canvas.search' }],
      },
    ]);
    await fixture.whenStable();

    expect(groupTitles()).toEqual(['Globaux (même fenêtre fermée)', 'Canevas', 'Collage rapide']);
    expect(keysFor('champ de recherche')).toEqual(['Ctrl', 'K']);
  });

  it('draws the separator between two caps rather than writing it', async () => {
    // A "+" inside a cap reads as a key to look for on the keyboard.
    const row = fixture.nativeElement.querySelector('.shortcut-keys') as HTMLElement;

    expect(row.querySelectorAll('kbd')).toHaveLength(3);
    expect(row.querySelectorAll('.shortcut-plus')).toHaveLength(2);
    expect(row.querySelector('.shortcut-plus')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('is a modal dialog, labelled by its own title', () => {
    const panel = fixture.nativeElement.querySelector('.sheet-panel') as HTMLElement;

    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-labelledby')).toBe('shortcuts-dialog-title');
  });

  it('closes from the button, the backdrop and Escape', async () => {
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => (closed += 1));

    (fixture.nativeElement.querySelector('.sheet-close') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('.sheet-backdrop') as HTMLElement).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();

    expect(closed).toBe(3);
  });
});
