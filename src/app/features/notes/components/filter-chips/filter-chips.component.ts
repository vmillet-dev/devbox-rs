import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NoteFilter } from '../../../../core/stores/notes.store';

const FILTERS: ReadonlyArray<{ key: NoteFilter; icon?: string; labelKey: string }> = [
  { key: 'all', labelKey: 'filters.all' },
  { key: 'pinned', icon: '📌', labelKey: 'filters.pinned' },
  { key: 'untriaged', icon: '⏳', labelKey: 'filters.untriaged' },
];

@Component({
  selector: 'app-filter-chips',
  imports: [TranslocoPipe],
  templateUrl: './filter-chips.component.html',
  styleUrl: './filter-chips.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterChipsComponent {
  protected readonly filters = FILTERS;

  readonly active = input.required<NoteFilter>();

  readonly filterChanged = output<NoteFilter>();
}
