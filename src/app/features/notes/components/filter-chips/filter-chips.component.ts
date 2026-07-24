import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NoteFilter } from '../../../../core/stores/notes.store';

const FILTERS: ReadonlyArray<{ key: NoteFilter; label: string }> = [
  { key: 'all', label: 'Tout' },
  { key: 'pinned', label: '📌 Épinglées' },
  { key: 'untriaged', label: '⏳ À trier' },
];

@Component({
  selector: 'app-filter-chips',
  templateUrl: './filter-chips.component.html',
  styleUrl: './filter-chips.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterChipsComponent {
  protected readonly filters = FILTERS;

  readonly active = input.required<NoteFilter>();

  readonly filterChanged = output<NoteFilter>();
}
