import { AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Without this a dialog is not keyboard-usable: focus stays on the element that opened
 * it, `Tab` walks the user through the content hidden behind the modal, and closing loses
 * focus into nothing. Written by hand rather than pulling in `@angular/cdk`.
 */
@Directive({
  selector: '[appFocusTrap]',
  host: {
    '(keydown.tab)': 'onTab($event, false)',
    '(keydown.shift.tab)': 'onTab($event, true)',
  },
})
export class FocusTrapDirective implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private previouslyFocused: HTMLElement | null = null;

  ngAfterViewInit(): void {
    this.previouslyFocused = document.activeElement as HTMLElement | null;
    this.focusableElements()[0]?.focus();
  }

  ngOnDestroy(): void {
    this.previouslyFocused?.focus();
  }

  // `Event` and not `KeyboardEvent`: modifier pseudo-events (`keydown.tab`) are absent
  // from the host-binding type table, so `typeCheckHostBindings` hands over an `Event`.
  protected onTab(event: Event, backwards: boolean): void {
    const elements = this.focusableElements();
    if (elements.length === 0) return;

    const first = elements[0];
    const last = elements.at(-1);
    if (!first || !last) return;

    const active = document.activeElement;

    // Only the two edges of the trap need intervention: native navigation does the rest.
    if (backwards && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!backwards && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusableElements(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }
}
