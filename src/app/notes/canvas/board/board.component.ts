import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { BoardNote, BoardZone } from '@core/model/board.model';
import { NoteActivation, NoteCardComponent } from '../note-card/note-card.component';
import { BoardZoneComponent } from './board-zone/board-zone.component';

/** What `folders::board::LOOSE_LABEL` leaves clear above the first loose card. */
const LABEL_OFFSET = 26;

/**
 * The second way to look at a space. Zones are placed from stored frames; cards flow
 * inside them and sit freely outside.
 *
 * ⚠️ Pan only, no zoom: a zoom is a second thing to persist and to reset, and full-size
 * cards are what makes the board worth panning in the first place.
 */
@Component({
  selector: 'app-board',
  imports: [BoardZoneComponent, NoteCardComponent, TranslocoPipe],
  templateUrl: './board.component.html',
  styleUrl: './board.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardComponent {
  readonly zones = input.required<readonly BoardZone[]>();
  readonly loose = input.required<readonly BoardNote[]>();
  readonly width = input.required<number>();
  readonly height = input.required<number>();

  readonly noteActivated = output<NoteActivation>();
  readonly folderOpened = output<string>();

  /** Just above the highest loose card, which is where the back end left room for it. */
  protected readonly looseLabelTop = computed(() => {
    const tops = this.loose().map((entry) => entry.position?.y ?? 0);
    return (tops.length > 0 ? Math.min(...tops) : 0) - LABEL_OFFSET;
  });
}
