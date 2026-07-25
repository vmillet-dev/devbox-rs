import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocaleService } from '@core/i18n/locale.service';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { TitlebarComponent } from './titlebar.component';

describe('TitlebarComponent', () => {
  let fixture: ComponentFixture<TitlebarComponent>;

  function localeOptions(): HTMLButtonElement[] {
    return [...fixture.nativeElement.querySelectorAll('.locale-option')];
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [TitlebarComponent], providers: [provideTranslocoTesting()] });
    fixture = TestBed.createComponent(TitlebarComponent);
    fixture.autoDetectChanges();
  });

  it('renders the default title when none is provided', () => {
    expect(fixture.nativeElement.querySelector('.titlebar-title').textContent.trim()).toBe('DevBox');
  });

  it('renders a custom title when provided', async () => {
    fixture.componentRef.setInput('title', 'Custom title');
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.titlebar-title').textContent.trim()).toBe('Custom title');
  });

  it('renders the three window-control dots, hidden from assistive tech', () => {
    expect(fixture.debugElement.queryAll(By.css('.dot'))).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('.dots').getAttribute('aria-hidden')).toBe('true');
  });

  it('renders a locale option per available locale, marking French active by default', () => {
    expect(localeOptions().map((option) => option.textContent?.trim())).toEqual(['FR', 'EN']);
    expect(localeOptions()[0].classList.contains('active')).toBe(true);
    expect(localeOptions()[1].classList.contains('active')).toBe(false);
  });

  it('exposes the active locale as a pressed toggle with a spelled-out name', () => {
    // "FR" alone is an abbreviation a screen reader spells out letter by letter.
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
