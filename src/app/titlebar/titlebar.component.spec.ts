import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocaleService } from '@core/services/i18n/locale.service';
import { VaultStore } from '@core/state/vault.store';
import { provideAppTesting } from '@testing/testing.providers';
import { TitlebarComponent } from './titlebar.component';

describe('TitlebarComponent', () => {
  let fixture: ComponentFixture<TitlebarComponent>;

  function localeOptions(): HTMLButtonElement[] {
    return [...fixture.nativeElement.querySelectorAll('.locale-option')];
  }

  /** With no choice made the active language is the system one, and jsdom's is `en-US`. */
  function stubSystemLanguage(tag: string): void {
    Object.defineProperty(navigator, 'languages', { value: [tag], configurable: true });
    Object.defineProperty(navigator, 'language', { value: tag, configurable: true });
  }

  /** The titlebar is on screen before the library is, so a spec has to say which. */
  async function unlock(): Promise<void> {
    await TestBed.inject(VaultStore).load();
    await fixture.whenStable();
  }

  function menus(): HTMLElement {
    return fixture.nativeElement.querySelector('.titlebar-menus');
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    stubSystemLanguage('fr-FR');
    TestBed.configureTestingModule({ imports: [TitlebarComponent], providers: [provideAppTesting()] });
    fixture = TestBed.createComponent(TitlebarComponent);
    fixture.autoDetectChanges();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'languages');
    Reflect.deleteProperty(navigator, 'language');
  });

  it('renders the application name', () => {
    expect(fixture.nativeElement.querySelector('.titlebar-title').textContent.trim()).toBe('DevNotes');
  });

  it('renders the three window-control dots, hidden from assistive tech', () => {
    expect(fixture.debugElement.queryAll(By.css('.dot'))).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('.dots').getAttribute('aria-hidden')).toBe('true');
  });

  it('groups the menus on the left, ahead of the title', async () => {
    await unlock();
    const title = fixture.nativeElement.querySelector('.titlebar-title');

    expect(menus().querySelector('app-file-menu')).not.toBeNull();
    expect(menus().querySelector('app-about-menu')).not.toBeNull();
    expect(menus().compareDocumentPosition(title)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  /** ⚠️ Every File entry acts on the library, and the component itself injects
   *  `SpacesStore`, which would query a database nobody has opened yet. */
  it('keeps the File menu out of the titlebar until the library is open', async () => {
    expect(menus().querySelector('app-file-menu')).toBeNull();
    expect(menus().querySelector('app-about-menu')).not.toBeNull();

    await unlock();

    expect(menus().querySelector('app-file-menu')).not.toBeNull();
  });

  it('renders a locale option per available locale, marking French active by default', () => {
    expect(localeOptions().map((option) => option.textContent?.trim())).toEqual(['FR', 'EN']);
    expect(localeOptions()[0].classList.contains('active')).toBe(true);
    expect(localeOptions()[1].classList.contains('active')).toBe(false);
  });

  it('exposes the active locale as a pressed toggle with a spelled-out name', () => {
    expect(localeOptions().map((option) => option.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(localeOptions()[0].getAttribute('aria-label')).toBe('Français');
  });

  it('switches the active locale when a locale option is clicked', async () => {
    const localeService = TestBed.inject(LocaleService);

    localeOptions()[1].click();
    await fixture.whenStable();

    expect(localeService.activeLocale()).toBe('en');
    expect(localeOptions()[1].classList.contains('active')).toBe(true);
    expect(localeOptions()[0].classList.contains('active')).toBe(false);
  });
});
