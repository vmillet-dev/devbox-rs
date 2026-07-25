import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NoteSection } from '@core/models/note-section.model';
import { NoteSectionComponent } from '../note-section/note-section.component';

@Component({
  selector: 'app-note-canvas',
  imports: [NoteSectionComponent, TranslocoPipe],
  templateUrl: './note-canvas.component.html',
  styleUrl: './note-canvas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteCanvasComponent {
  readonly sections = input.required<readonly NoteSection[]>();
  readonly selectedNoteId = input<string | null>(null);
  readonly isLoading = input(false);
  /** Échec du chargement initial : le canevas propose alors de réessayer. */
  readonly loadError = input<Error | undefined>(undefined);
  /** Une recherche est active mais ne renvoie rien — à distinguer d'un espace vide. */
  readonly hasNoResults = input(false);

  readonly noteOpened = output<string>();
  readonly createRequested = output<void>();
  readonly reloadRequested = output<void>();
}
