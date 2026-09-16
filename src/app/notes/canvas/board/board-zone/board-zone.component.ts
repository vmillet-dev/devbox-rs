import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { BoardZone } from '@core/model/board.model';
import { NoteActivation, NoteCardComponent } from '@notes/canvas/note-card/note-card.component';

/**
 * A folder drawn as a titled, coloured region. Its notes **flow** inside it rather than
 * carrying coordinates of their own: the inside of a folder is already sorted by the fact
 * of being there, and a second set of positions would be a second thing to keep straight.
 */
@Component({
  selector: 'app-board-zone',
  imports: [NoteCardComponent, TranslocoPipe],
  templateUrl: './board-zone.component.html',
  styleUrl: './board-zone.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardZoneComponent {
  readonly zone = input.required<BoardZone>();

  readonly noteActivated = output<NoteActivation>();
  readonly opened = output<string>();

  protected readonly headingId = computed(() => `board-zone-${this.zone().folder.id}`);
}
