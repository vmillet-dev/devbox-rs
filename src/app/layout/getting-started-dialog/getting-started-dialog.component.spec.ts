import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '@core/settings/settings.store';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { GettingStartedDialogComponent } from './getting-started-dialog.component';

describe('GettingStartedDialogComponent', () => {
  let fixture: ComponentFixture<GettingStartedDialogComponent>;
  let settings: SettingsStore;

  const titles = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.guide-chapter-title')).map((title) =>
      (title as HTMLElement).textContent!.trim(),
    );

  const bodies = (): string =>
    Array.from(fixture.nativeElement.querySelectorAll('.guide-chapter-body'))
      .map((body) => (body as HTMLElement).textContent!)
      .join('\n');

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [GettingStartedDialogComponent],
      providers: [provideTranslocoTesting()],
    });
    settings = TestBed.inject(SettingsStore);
    fixture = TestBed.createComponent(GettingStartedDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  it('opens on the notes and ends on import/export', () => {
    // The order is the order one meets the features, not an alphabet.
    expect(titles()).toHaveLength(9);
    expect(titles()[0]).toContain('notes');
    expect(titles().at(-1)).toContain('Entrer et sortir');
  });

  it('numbers the chapters for the eye only', () => {
    const steps = Array.from(fixture.nativeElement.querySelectorAll('.guide-step'));

    expect(steps.map((step) => (step as HTMLElement).textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ]);
    // The headings already carry the order for a screen reader.
    expect(steps.every((step) => (step as HTMLElement).getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('names the quick-paste key that is really bound', async () => {
    expect(bodies()).toContain('Ctrl+Alt+P');

    settings.setPaletteShortcut('Ctrl+Shift+K');
    await fixture.whenStable();

    // A guide quoting the combination that shipped would be wrong for anyone
    // who changed it.
    expect(bodies()).toContain('Ctrl+Shift+K');
    expect(bodies()).not.toContain('Ctrl+Alt+P');
  });

  it('leaves no interpolation unfilled', () => {
    // Transloco replaces an unknown `{{param}}` with nothing, which would eat a
    // word in the middle of a sentence rather than fail loudly.
    expect(bodies()).not.toContain('{{');
  });

  it('closes from the button, the backdrop and Escape', async () => {
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => (closed += 1));

    (fixture.nativeElement.querySelector('.guide-close') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('.guide-backdrop') as HTMLElement).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();

    expect(closed).toBe(3);
  });
});
