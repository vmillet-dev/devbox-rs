import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { SearchBoxComponent } from './search-box.component';

describe('SearchBoxComponent', () => {
  let fixture: ComponentFixture<SearchBoxComponent>;

  function input(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input');
  }

  function pressShortcut(): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    document.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SearchBoxComponent], providers: [provideTranslocoTesting()] });
    fixture = TestBed.createComponent(SearchBoxComponent);
    // jsdom only tracks `document.activeElement` for attached elements.
    document.body.appendChild(fixture.nativeElement);
    fixture.autoDetectChanges();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
  });

  it('renders the provided query in the input', async () => {
    fixture.componentRef.setInput('query', 'hello');
    await fixture.whenStable();

    expect(input().value).toBe('hello');
  });

  it('emits the new value when the user types', () => {
    let emitted: string | undefined;
    fixture.componentInstance.query.subscribe((value: string) => (emitted = value));

    input().value = 'search term';
    input().dispatchEvent(new Event('input'));

    expect(emitted).toBe('search term');
  });

  it('gives the input an accessible name of its own', () => {
    expect(input().getAttribute('aria-label')).toBe('Rechercher dans les notes');
  });

  it('hides the decorative magnifier and shortcut hint from assistive tech', () => {
    const decorations = [...fixture.nativeElement.querySelectorAll('label > span')];

    expect(decorations.every((span: Element) => span.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  /**
   * The count was computed in Rust, crossed the bridge and was thrown away on arrival —
   * `NotesView.matched` decided one boolean and was never shown.
   */
  describe('the count', () => {
    it('replaces the shortcut hint while something is being filtered', async () => {
      fixture.componentRef.setInput('matched', 12);
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelector('[data-testid="search-matched"]').textContent.trim()).toBe(
        '12 résultat(s)',
      );
      expect(fixture.nativeElement.querySelector('.kbd')).toBeNull();
    });

    it('says zero rather than falling back to the hint', async () => {
      // The answer that matters most, and the one a truthiness check would swallow.
      fixture.componentRef.setInput('matched', 0);
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelector('[data-testid="search-matched"]').textContent.trim()).toBe(
        '0 résultat(s)',
      );
    });

    it('shows the hint again when nothing is being filtered', async () => {
      fixture.componentRef.setInput('matched', null);
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelector('[data-testid="search-matched"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('.kbd')).not.toBeNull();
    });
  });

  it('focuses the input on Ctrl/Cmd+K and prevents the browser default', () => {
    const event = pressShortcut();

    expect(document.activeElement).toBe(input());
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores keydown events that are not the shortcut', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));

    expect(document.activeElement).not.toBe(input());
  });

  it('ignores the shortcut while it is disabled', async () => {
    fixture.componentRef.setInput('shortcutEnabled', false);
    await fixture.whenStable();

    const event = pressShortcut();

    expect(document.activeElement).not.toBe(input());
    expect(event.defaultPrevented).toBe(false);
  });
});
