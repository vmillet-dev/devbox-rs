import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '../../../testing/provide-transloco-testing';
import { LocaleService } from '../../core/i18n/locale.service';
import { TitlebarComponent } from './titlebar.component';

describe('TitlebarComponent', () => {
  let fixture: ComponentFixture<TitlebarComponent>;

  beforeEach(() => {
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

  it('renders the three window-control dots', () => {
    expect(fixture.debugElement.queryAll(By.css('.dot'))).toHaveLength(3);
  });

  it('renders a locale option per available locale, marking French active by default', () => {
    const options = fixture.debugElement.queryAll(By.css('.locale-option'));

    expect(options.map((option) => option.nativeElement.textContent.trim())).toEqual(['FR', 'EN']);
    expect(options[0].classes['active']).toBe(true);
    expect(options[1].classes['active']).toBeFalsy();
  });

  it('switches the active locale when a locale option is clicked', async () => {
    const localeService = TestBed.inject(LocaleService);

    fixture.debugElement.queryAll(By.css('.locale-option'))[1].triggerEventHandler('click');
    await fixture.whenStable();

    expect(localeService.activeLocale()).toBe('en');
    const options = fixture.debugElement.queryAll(By.css('.locale-option'));
    expect(options[1].classes['active']).toBe(true);
    expect(options[0].classes['active']).toBeFalsy();
  });
});
