import { ChangeDetectionStrategy, Component, input, output, viewChild } from '@angular/core';
import { Space } from '../../../../core/models/space.model';
import { NoteFilter } from '../../../../core/stores/notes.store';
import { SpaceSwitcherComponent } from '../space-switcher/space-switcher.component';
import { SearchBoxComponent } from '../search-box/search-box.component';
import { FilterChipsComponent } from '../filter-chips/filter-chips.component';

@Component({
  selector: 'app-notes-topbar',
  imports: [SpaceSwitcherComponent, SearchBoxComponent, FilterChipsComponent],
  templateUrl: './notes-topbar.component.html',
  styleUrl: './notes-topbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotesTopbarComponent {
  readonly spaces = input.required<Space[]>();
  readonly activeSpace = input.required<Space>();
  readonly searchQuery = input('');
  readonly activeFilter = input.required<NoteFilter>();

  readonly spaceChanged = output<string>();
  readonly searchQueryChanged = output<string>();
  readonly filterChanged = output<NoteFilter>();
  readonly newNoteRequested = output<void>();

  private readonly searchBox = viewChild.required(SearchBoxComponent);

  focusSearch(): void {
    this.searchBox().focus();
  }
}
