import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '@core/services/settings/settings.store';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { SettingsPageComponent } from './settings-page.component';

describe('SettingsPageComponent', () => {
  let fixture: ComponentFixture<SettingsPageComponent>;
  let settings: SettingsStore;

  function select(id: string): HTMLSelectElement {
    return fixture.nativeElement.querySelector(`#${id}`);
  }

  function toggle(id: string): HTMLInputElement {
    return fixture.nativeElement.querySelector(`#${id}`);
  }

  function shortcutField(): HTMLInputElement {
    return fixture.nativeElement.querySelector('#setting-shortcut');
  }

  function press(init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
    shortcutField().dispatchEvent(event);
    return event;
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SettingsPageComponent],
      providers: [provideTranslocoTesting()],
    });
    settings = TestBed.inject(SettingsStore);
    fixture = TestBed.createComponent(SettingsPageComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  it('shows the four groups the panel is made of', () => {
    const titles = [...fixture.nativeElement.querySelectorAll('.setting-group-title')].map(
      (title: HTMLElement) => title.textContent?.trim(),
    );

    expect(titles).toEqual(['Apparence', 'Comportement', 'Collage rapide', 'Notifications']);
  });

  it('offers the language alongside the titlebar buttons, system included', () => {
    const options = [...select('setting-locale').options].map((option) => option.value);

    expect(options).toEqual(['system', 'fr', 'en']);
    expect(select('setting-locale').value).toBe('system');
  });

  it('writes a chosen language straight through', async () => {
    select('setting-locale').value = 'en';
    select('setting-locale').dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(settings.locale()).toBe('en');
  });

  it('shows the active theme as the selected option', () => {
    expect(select('setting-theme').value).toBe('system');
  });

  it('writes a chosen theme straight through, with nothing to validate', async () => {
    select('setting-theme').value = 'light';
    select('setting-theme').dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(settings.theme()).toBe('light');
  });

  it('binds every toggle to its setting', async () => {
    toggle('setting-close-to-tray').click();
    toggle('setting-pinned-first').click();
    toggle('setting-copy-confirmation').click();
    await fixture.whenStable();

    expect(settings.closeToTray()).toBe(false);
    expect(settings.showPinnedFirst()).toBe(false);
    expect(settings.copyConfirmation()).toBe(false);
  });

  it('records a shortcut from the keystroke rather than from typed text', async () => {
    press({ code: 'KeyK', ctrlKey: true, shiftKey: true });
    await fixture.whenStable();

    expect(settings.paletteShortcut()).toBe('Ctrl+Shift+K');
    expect(shortcutField().value).toBe('Ctrl+Shift+K');
  });

  it('lets a bare keystroke through, which is what keeps Tab and Escape working', () => {
    const event = press({ code: 'Tab' });

    expect(event.defaultPrevented).toBe(false);
    expect(settings.paletteShortcut()).toBe('Ctrl+Alt+P');
  });

  it('offers to restore the original combination, and only once it changed', async () => {
    const reset = (): HTMLButtonElement => fixture.nativeElement.querySelector('.setting-shortcut-reset');
    expect(reset().disabled).toBe(true);

    press({ code: 'KeyK', ctrlKey: true, shiftKey: true });
    await fixture.whenStable();
    reset().click();
    await fixture.whenStable();

    expect(settings.paletteShortcut()).toBe('Ctrl+Alt+P');
  });
});
