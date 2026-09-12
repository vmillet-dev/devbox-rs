import { Directive, ElementRef, inject, output, signal } from '@angular/core';

/**
 * A dropdown's open/closed state, and the two ways out of it without clicking an entry: a
 * click outside and Escape. The trigger is named by `[appMenuAnchor]` — focus returns to
 * it on close, which it would otherwise lose to `<body>`.
 *
 * Escape is emitted rather than handled here: a multi-level menu must be able to fold its
 * panel before closing (see `SpaceSwitcher`).
 */
@Directive({
  selector: '[appMenuTrigger]',
  exportAs: 'appMenu',
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(keydown.escape)': 'escaped.emit()',
  },
})
export class MenuTriggerDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly _open = signal(false);
  readonly open = this._open.asReadonly();

  /** Escape pressed while the menu is open. */
  readonly escaped = output<void>();
  /** The menu has just closed, whatever the cause. */
  readonly closed = output<void>();

  toggle(): void {
    if (this._open()) {
      this.close();
      return;
    }
    this._open.set(true);
  }

  /** Left `false` when closing opens something else that will take focus. */
  close(restoreFocus = true): void {
    if (!this._open()) return;

    this._open.set(false);
    this.closed.emit();
    if (restoreFocus) {
      this.focusAnchor();
    }
  }

  focusAnchor(): void {
    this.host.nativeElement.querySelector<HTMLElement>('[appMenuAnchor]')?.focus();
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this._open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.close(false);
    }
  }
}
