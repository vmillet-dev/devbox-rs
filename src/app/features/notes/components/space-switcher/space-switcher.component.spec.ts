import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Space } from '@core/models/space.model';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { SpaceSwitcherComponent } from './space-switcher.component';

const SPACES: readonly Space[] = [
  { id: 'work', name: 'Work' },
  { id: 'personal', name: 'Personal' },
];

describe('SpaceSwitcherComponent', () => {
  let fixture: ComponentFixture<SpaceSwitcherComponent>;

  function trigger(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.space-switch');
  }

  function options(): HTMLButtonElement[] {
    return [...fixture.nativeElement.querySelectorAll('.space-option')];
  }

  async function open(): Promise<void> {
    trigger().click();
    await fixture.whenStable();
  }

  async function pressKey(key: string): Promise<void> {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [SpaceSwitcherComponent],
      providers: [provideTranslocoTesting()],
    });
    fixture = TestBed.createComponent(SpaceSwitcherComponent);
    fixture.componentRef.setInput('spaces', SPACES);
    fixture.componentRef.setInput('activeSpace', SPACES[0]);
    // jsdom only tracks `document.activeElement` for attached elements.
    document.body.appendChild(fixture.nativeElement);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
  });

  it('shows the active space name and keeps the dropdown closed by default', () => {
    expect(trigger().textContent).toContain('Work');
    expect(fixture.debugElement.query(By.css('.space-dropdown'))).toBeNull();
  });

  it('renders a placeholder while the spaces are still loading', async () => {
    fixture.componentRef.setInput('activeSpace', null);
    await fixture.whenStable();

    expect(trigger().textContent).toContain('—');
  });

  it('opens the dropdown listing every space when toggled', async () => {
    await open();

    expect(options().map((option) => option.textContent?.trim())).toEqual(['Work', 'Personal']);
  });

  it('marks the active space option', async () => {
    await open();

    expect(options()[0].classList.contains('active')).toBe(true);
    expect(options()[0].getAttribute('aria-checked')).toBe('true');
    expect(options()[1].getAttribute('aria-checked')).toBe('false');
  });

  it('emits spaceChanged and closes the dropdown when a space is selected', async () => {
    let emitted: string | undefined;
    fixture.componentInstance.spaceChanged.subscribe((id) => (emitted = id));

    await open();
    options()[1].click();
    await fixture.whenStable();

    expect(emitted).toBe('personal');
    expect(fixture.debugElement.query(By.css('.space-dropdown'))).toBeNull();
  });

  it('closes the dropdown when clicking outside the component', async () => {
    await open();
    expect(fixture.debugElement.query(By.css('.space-dropdown'))).not.toBeNull();

    const outsideClick = new MouseEvent('click');
    Object.defineProperty(outsideClick, 'target', { value: document.body });
    document.dispatchEvent(outsideClick);
    await fixture.whenStable();

    expect(fixture.debugElement.query(By.css('.space-dropdown'))).toBeNull();
  });

  it('does not close the dropdown when clicking inside the component', async () => {
    await open();

    const insideClick = new MouseEvent('click');
    Object.defineProperty(insideClick, 'target', { value: trigger() });
    document.dispatchEvent(insideClick);
    await fixture.whenStable();

    expect(fixture.debugElement.query(By.css('.space-dropdown'))).not.toBeNull();
  });

  describe('keyboard and assistive technology', () => {
    it('announces the expanded state of the trigger', async () => {
      expect(trigger().getAttribute('aria-expanded')).toBe('false');

      await open();

      expect(trigger().getAttribute('aria-expanded')).toBe('true');
    });

    it('moves focus to the first option on open, so the menu is reachable at all', async () => {
      await open();

      expect(document.activeElement).toBe(options()[0]);
    });

    it('moves through the options with the arrow keys, wrapping around', async () => {
      await open();

      await pressKey('ArrowDown');
      expect(document.activeElement).toBe(options()[1]);

      await pressKey('ArrowDown');
      expect(document.activeElement).toBe(options()[0]);

      await pressKey('ArrowUp');
      expect(document.activeElement).toBe(options()[1]);
    });

    it('jumps to the first and last option with Home and End', async () => {
      await open();

      await pressKey('End');
      expect(document.activeElement).toBe(options()[1]);

      await pressKey('Home');
      expect(document.activeElement).toBe(options()[0]);
    });

    it('closes on Escape and returns focus to the trigger', async () => {
      await open();

      await pressKey('Escape');

      expect(fixture.debugElement.query(By.css('.space-dropdown'))).toBeNull();
      expect(document.activeElement).toBe(trigger());
    });

    it('returns focus to the trigger after picking an option', async () => {
      await open();

      options()[1].click();
      await fixture.whenStable();

      expect(document.activeElement).toBe(trigger());
    });
  });
});
