import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-tag-pill',
  templateUrl: './tag-pill.component.html',
  styleUrl: './tag-pill.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagPillComponent {
  readonly label = input.required<string>();
  readonly active = input(false);
  readonly interactive = input(true);

  readonly toggled = output<string>();

  protected onClick(): void {
    if (this.interactive()) {
      this.toggled.emit(this.label());
    }
  }
}
