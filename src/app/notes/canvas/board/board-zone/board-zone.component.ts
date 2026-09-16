import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { BoardFrame, BoardNote, BoardZone } from '@core/model/board.model';
import { NoteActivation, NoteCardComponent } from '@notes/canvas/note-card/note-card.component';

/** A card grabbed inside a zone, with where it sits so the drag keeps its offset. */
export interface CardGrab {
  readonly event: PointerEvent;
  readonly entry: BoardNote;
  readonly frame: BoardFrame;
}

/**
 * A folder drawn as a titled, coloured region. Its notes **flow** inside it rather than
 * carrying coordinates of their own: the inside of a folder is already sorted by the fact
 * of being there, and a second set of positions would be a second thing to keep straight.
 *
 * ⚠️ Moving a zone carries its notes, and resizing one captures and releases nothing —
 * both fall out of the flow rather than being coded. Unreal's own rule, where a comment
 * owns whatever it overlaps, was considered and refused: it silently refiles notes the day
 * a frame is stretched.
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
  /** The frame as it is right now — the board's, so a drag in progress shows. */
  readonly frame = input.required<BoardFrame>();
  readonly editable = input(true);
  readonly isDropTarget = input(false);
  readonly isMoving = input(false);
  /** The card being dragged out of here, if any: it is drawn on the surface instead. */
  readonly draggingNoteId = input<string | null>(null);

  readonly noteActivated = output<NoteActivation>();
  readonly opened = output<string>();
  readonly headGrabbed = output<PointerEvent>();
  readonly resizeGrabbed = output<PointerEvent>();
  readonly cardGrabbed = output<CardGrab>();

  protected readonly headingId = computed(() => `board-zone-${this.zone().folder.id}`);

  /** A card flows here, so its drag starts from where the zone is rather than from itself. */
  protected grabCard(event: PointerEvent, entry: BoardNote): void {
    const box = (event.currentTarget as HTMLElement).closest('.zone-card')?.getBoundingClientRect();
    const surface = (event.currentTarget as HTMLElement).closest('.board-surface')?.getBoundingClientRect();

    const frame: BoardFrame =
      box && surface
        ? {
            x: Math.round(box.left - surface.left),
            y: Math.round(box.top - surface.top),
            width: 0,
            height: 0,
          }
        : { x: this.frame().x, y: this.frame().y, width: 0, height: 0 };

    this.cardGrabbed.emit({ event, entry, frame });
  }
}
