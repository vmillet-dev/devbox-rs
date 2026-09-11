import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DialogBackdropDirective } from '@shared/a11y/dialog-backdrop.directive';
import { FocusTrapDirective } from '@shared/a11y/focus-trap.directive';

/**
 * An attached image at full size, above everything else.
 *
 * The strip bounds its preview to 220 px so as not to push the editor off
 * screen, where a code screenshot is unreadable. This view bounds only on the
 * window.
 *
 * It re-reads nothing: the bytes are the ones the preview already loaded, and a
 * multi-megabyte `data:` URI has no business crossing the bridge twice.
 */
@Component({
  selector: 'app-image-lightbox',
  imports: [DialogBackdropDirective, FocusTrapDirective, TranslocoPipe],
  templateUrl: './image-lightbox.component.html',
  styleUrl: './image-lightbox.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class ImageLightboxComponent {
  /** A `data:` URI already in memory: the CSP forbids a file path. */
  readonly source = input.required<string>();
  readonly fileName = input.required<string>();

  readonly closed = output<void>();
}
