import { ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'app-search-box',
  imports: [TranslocoPipe],
  templateUrl: './search-box.component.html',
  styleUrl: './search-box.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchBoxComponent {
  readonly query = input('');

  readonly queryChange = output<string>();

  private readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');

  focus(): void {
    this.inputRef().nativeElement.focus();
  }

  protected onInput(value: string): void {
    this.queryChange.emit(value);
  }
}
