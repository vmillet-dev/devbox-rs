import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { DialogBackdropDirective } from '@shared/directives/dialog-backdrop.directive';
import { DialogLayer, DialogVariant, dialogRung } from './dialog.model';
import { DialogStack } from './dialog-stack';
import { FocusTrapDirective } from '@shared/directives/focus-trap.directive';

/**
 * The frame every modal shares: scrim, focus trap, `role="dialog"`, Escape and the
 * backdrop click. Each dialog used to recopy all six, which made an accessibility fix a
 * twelve-file change and let two open dialogs answer the same Escape.
 *
 * What a shell cannot guess — how wide the panel is, the gap between its blocks, its
 * padding — are CSS custom properties a consumer sets on the `app-dialog` element. No
 * measurement travels through an `input()`, and none is spelled in a template.
 */
@Component({
  selector: 'app-dialog',
  imports: [DialogBackdropDirective, FocusTrapDirective],
  templateUrl: './dialog.component.html',
  styleUrl: './dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'dismiss()',
  },
})
export class DialogComponent implements OnInit {
  private readonly stack = inject(DialogStack);

  readonly layer = input.required<DialogLayer>();
  readonly variant = input<DialogVariant>('fitted');
  /** Fills the window: the same panel, without the frame that bounds it. */
  readonly fullscreen = input(false);

  readonly labelledBy = input<string>();
  readonly label = input<string>();

  /**
   * `false` while an operation cannot be interrupted — installing an update replaces the
   * files on disk.
   */
  readonly dismissible = input(true);

  readonly closed = output<void>();

  protected readonly rung = computed(() => dialogRung(this.layer()));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stack.remove(this));
  }

  /**
   * Joining the stack is the moment the dialog opens: an `@if` in the page is what puts
   * one on screen, so there is no separate "open" to listen for.
   *
   * ⚠️ `ngOnInit` and not the constructor: `layer` is a required input, which has no value
   * yet while the component is being built.
   */
  ngOnInit(): void {
    this.stack.push(this, this.rung());
  }

  protected dismiss(): void {
    if (this.dismissible() && this.stack.isFront(this)) {
      this.closed.emit();
    }
  }
}
