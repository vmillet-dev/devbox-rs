import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NoteSection } from '@core/models/note-section.model';
import { Space } from '@core/models/space.model';
import { NoteCardComponent, NoteMove } from '../note-card/note-card.component';

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
  /** Relayé aux cartes : leur menu propose d'y déplacer la note. */
  readonly spaces = input<readonly Space[]>([]);

  readonly noteOpened = output<string>();
  readonly noteMoved = output<NoteMove>();
  readonly noteDeleted = output<string>();
  readonly createRequested = output<void>();

  /** La clé de section *est* la clé de traduction : aucun libellé à maintenir en double. */
  protected readonly titleKey = computed(() => `sections.${this.section().key}`);

  /** Rattache la région à son titre, pour la navigation par régions des lecteurs d'écran. */
  protected readonly headingId = computed(() => `section-heading-${this.section().key}`);
}
