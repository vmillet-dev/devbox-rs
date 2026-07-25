import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Space } from '@core/models/space.model';
import { NoteFilter } from '@core/stores/notes.store';
import { FilterChipsComponent } from '../filter-chips/filter-chips.component';
import { SearchBoxComponent } from '../search-box/search-box.component';
import { SpaceSwitcherComponent } from '../space-switcher/space-switcher.component';

@Component({
  selector: 'app-notes-topbar',
  imports: [SpaceSwitcherComponent, SearchBoxComponent, FilterChipsComponent, TranslocoPipe],
  templateUrl: './notes-topbar.component.html',
  styleUrl: './notes-topbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotesTopbarComponent {
  readonly spaces = input.required<readonly Space[]>();
  readonly activeSpace = input.required<Space | null>();
  readonly searchQuery = input('');
  readonly activeFilter = input.required<NoteFilter>();
  /** Simplement relayé : le raccourci appartient désormais au champ de recherche. */
  readonly searchShortcutEnabled = input(true);

  readonly spaceChanged = output<string>();
  readonly searchQueryChanged = output<string>();
  readonly filterChanged = output<NoteFilter>();
  readonly newNoteRequested = output<void>();
}
