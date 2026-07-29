import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Note } from '@core/models/note.model';
import { Space } from '@core/models/space.model';
import { TranslationRef } from '@core/i18n/translation-ref';
import { ClockService } from '@core/time/clock.service';
import { expiryRef, relativeTimeRef } from '@core/utils/relative-time.util';
import { CodeViewerComponent } from '@shared/ui/code-viewer/code-viewer.component';
import { LanguageBadgeComponent } from '@shared/ui/language-badge/language-badge.component';
import { NoteCardMenuComponent } from '../note-card-menu/note-card-menu.component';

/** Le libellé du pied de carte est soit du texte brut (nom de source), soit une référence de traduction (temps). */
type FooterLabel = { kind: 'text'; value: string } | { kind: 'ref'; ref: TranslationRef };

/** Déplacement demandé depuis le menu d'une carte. */
export interface NoteMove {
  readonly noteId: string;
  readonly spaceId: string;
}

const SNIPPET_LINES = 3;
const MAX_VISIBLE_TAGS = 2;

@Component({
  selector: 'app-note-card',
  imports: [CodeViewerComponent, LanguageBadgeComponent, NoteCardMenuComponent, TranslocoPipe],
  templateUrl: './note-card.component.html',
  styleUrl: './note-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteCardComponent {
  private readonly clock = inject(ClockService);

  readonly note = input.required<Note>();
  readonly selected = input(false);
  /** Destinations proposées par le menu ; l'espace de la note en est retiré. */
  readonly spaces = input<readonly Space[]>([]);

  readonly opened = output<string>();
  readonly moveRequested = output<NoteMove>();
  readonly deleteRequested = output<string>();

  protected readonly snippet = computed(() =>
    this.note().content.split('\n').slice(0, SNIPPET_LINES).join('\n'),
  );

  protected readonly displayedTags = computed(() => this.note().tags.slice(0, MAX_VISIBLE_TAGS));

  /**
   * Le back a déjà tranché **quoi** afficher ; il ne reste qu'à le rendre. Les
   * deux variantes datées sont formatées ici pour que le libellé vieillisse à
   * l'écran, sans nouvelle requête.
   */
  protected readonly footerLabel = computed<FooterLabel>(() => {
    const footer = this.note().footer;
    if (footer.kind === 'source') {
      return { kind: 'text', value: footer.value };
    }
    if (footer.kind === 'expiry') {
      return { kind: 'ref', ref: expiryRef(footer.at, this.clock.now()) };
    }
    return { kind: 'ref', ref: relativeTimeRef(footer.at, this.clock.now()) };
  });

  protected onOpen(): void {
    this.opened.emit(this.note().id);
  }

  /** Le menu ne connaît pas la note : c'est la carte qui rattache l'identifiant. */
  protected onMove(spaceId: string): void {
    this.moveRequested.emit({ noteId: this.note().id, spaceId });
  }

  protected onDelete(): void {
    this.deleteRequested.emit(this.note().id);
  }
}
