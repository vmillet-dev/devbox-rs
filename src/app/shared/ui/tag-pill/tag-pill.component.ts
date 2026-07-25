import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-tag-pill',
  templateUrl: './tag-pill.component.html',
  styleUrl: './tag-pill.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagPillComponent {
  readonly label = input.required<string>();
  readonly active = input(false);
  /** À `false`, le tag n'est plus qu'un libellé (voir le template). */
  readonly interactive = input(true);

  readonly toggled = output<string>();

  protected onClick(): void {
    this.toggled.emit(this.label());
  }
}
