import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppInfoService } from '@core/app-info/app-info.service';
import { UpdateStore } from '@core/updates/update.store';
import { UpdaterService } from '@core/updates/updater.service';
import { AboutDialogComponent } from '@layout/about-dialog/about-dialog.component';
import { FakeAppInfo } from '@testing/fake-app-info';
import { FakeUpdater } from '@testing/fake-updater';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { AboutMenuComponent } from './about-menu.component';

describe('AboutMenuComponent', () => {
  let fixture: ComponentFixture<AboutMenuComponent>;
  let updater: FakeUpdater;
  let store: UpdateStore;

  const trigger = (): HTMLButtonElement => fixture.nativeElement.querySelector('.about-trigger');
  const options = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.about-option'));

  async function openMenu(): Promise<void> {
    trigger().click();
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    updater = new FakeUpdater();
    TestBed.configureTestingModule({
      imports: [AboutMenuComponent],
      providers: [
        { provide: UpdaterService, useValue: updater },
        { provide: AppInfoService, useValue: new FakeAppInfo() },
        provideTranslocoTesting(),
      ],
    });
    store = TestBed.inject(UpdateStore);
    fixture = TestBed.createComponent(AboutMenuComponent);
    fixture.autoDetectChanges();
  });

  it('keeps the menu closed until asked', () => {
    expect(fixture.debugElement.query(By.css('.about-dropdown'))).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens as a menu and moves focus to its first entry', async () => {
    await openMenu();

    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('.about-dropdown').getAttribute('role')).toBe('menu');
    expect(options()).toHaveLength(2);
    // A menu opened without focus is unreachable from the keyboard.
    expect(document.activeElement).toBe(options()[0]);
  });

  it('cycles focus through the entries with the arrow keys', async () => {
    await openMenu();

    fixture.debugElement
      .query(By.css('.about-dropdown'))
      .triggerEventHandler('keydown', new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(document.activeElement).toBe(options()[1]);

    fixture.debugElement
      .query(By.css('.about-dropdown'))
      .triggerEventHandler('keydown', new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(document.activeElement).toBe(options()[0]);
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    await openMenu();

    // Dispatched for real so it bubbles from the focused entry up to the host,
    // which is where the `(keydown.escape)` binding lives.
    options()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();

    expect(fixture.debugElement.query(By.css('.about-dropdown'))).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on a click outside itself', async () => {
    await openMenu();

    document.body.click();
    await fixture.whenStable();

    expect(fixture.debugElement.query(By.css('.about-dropdown'))).toBeNull();
  });

  it('reports that the app is up to date, which the startup check never does', async () => {
    await openMenu();

    options()[0].click();
    await fixture.whenStable();

    expect(updater.checkCalls).toBe(1);
    expect(store.checkState()).toBe('upToDate');
    expect(fixture.nativeElement.querySelector('.about-option-status').textContent).toContain('à jour');
  });

  it('announces the status without stealing focus', async () => {
    await openMenu();

    expect(fixture.nativeElement.querySelector('.about-option-status').getAttribute('aria-live')).toBe(
      'polite',
    );
  });

  it('reports a failed check in place', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    updater.checkError = new Error('network unreachable');
    await openMenu();

    options()[0].click();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.about-option-status').textContent).toContain('impossible');
    warn.mockRestore();
  });

  it('ignores a second click while a check is running', async () => {
    updater.deferCheck = true;
    await openMenu();

    options()[0].click();
    await fixture.whenStable();
    options()[0].click();
    await fixture.whenStable();

    expect(options()[0].getAttribute('aria-disabled')).toBe('true');
    expect(updater.checkCalls).toBe(1);

    updater.finishCheck();
    await fixture.whenStable();
  });

  it('opens the about dialog from the second entry and closes the menu', async () => {
    await openMenu();

    options()[1].click();
    await fixture.whenStable();

    expect(fixture.debugElement.query(By.directive(AboutDialogComponent))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('.about-dropdown'))).toBeNull();
  });

  it('returns focus to the trigger when the dialog closes', async () => {
    await openMenu();
    options()[1].click();
    await fixture.whenStable();

    fixture.debugElement.query(By.css('.about-close')).triggerEventHandler('click');
    await fixture.whenStable();

    expect(fixture.debugElement.query(By.directive(AboutDialogComponent))).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});
