import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '@core/services/settings/settings.store';
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
    expect(titles()).toHaveLength(10);
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
      '10',
    ]);
    expect(steps.every((step) => (step as HTMLElement).getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('names the quick-paste key that is really bound', async () => {
    expect(bodies()).toContain('Ctrl+Alt+P');

    settings.setPaletteShortcut('Ctrl+Shift+K');
    await fixture.whenStable();

    expect(bodies()).toContain('Ctrl+Shift+K');
    expect(bodies()).not.toContain('Ctrl+Alt+P');
  });

  it('leaves no interpolation unfilled', () => {
    expect(bodies()).not.toContain('{{');
  });

  it('closes from its button', async () => {
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => (closed += 1));

    (fixture.nativeElement.querySelector('.guide-close') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(closed).toBe(1);
  });
});
