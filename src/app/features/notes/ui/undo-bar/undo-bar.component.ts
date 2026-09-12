import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * `role="status"` and not `alert`: a deletion the user asked for is not an alert, and a
 * screen reader must not interrupt to announce it.
 */
@Component({
  selector: 'app-undo-bar',
  imports: [TranslocoPipe],
  templateUrl: './undo-bar.component.html',
  styleUrl: './undo-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UndoBarComponent {
  readonly count = input.required<number>();

  readonly undone = output<void>();
  readonly dismissed = output<void>();
}
