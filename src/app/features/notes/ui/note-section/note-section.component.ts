import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NoteSection } from '@features/notes/model/note.model';
import { Space } from '@features/notes/model/space.model';
import { ItemToggle, NoteActivation, NoteCardComponent, NoteMove } from '../note-card/note-card.component';

@Component({
  selector: 'app-note-section',
  imports: [NoteCardComponent, TranslocoPipe],
  templateUrl: './note-section.component.html',
  styleUrl: './note-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteSectionComponent {
  readonly section = input.required<NoteSection>();
  readonly selectedNoteId = input<string | null>(null);
  readonly focusedNoteId = input<string | null>(null);
  readonly checkedIds = input<ReadonlySet<string>>(new Set());
  /** Relayed to the cards: their menu offers to move the note there. */
  readonly spaces = input<readonly Space[]>([]);

  readonly noteOpened = output<NoteActivation>();
  readonly noteChecked = output<string>();
  readonly noteMoved = output<NoteMove>();
  readonly noteDeleted = output<string>();
  readonly fillRequested = output<string>();
  readonly createRequested = output<void>();
  /** A todo-list box ticked from the canvas. */
  readonly itemToggled = output<ItemToggle>();

  /** The section key *is* the translation key: no label kept in two places. */
  protected readonly titleKey = computed(() => `sections.${this.section().key}`);

  /** Ties the region to its heading, for screen-reader region navigation. */
  protected readonly headingId = computed(() => `section-heading-${this.section().key}`);
}
