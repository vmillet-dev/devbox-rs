import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Note } from '@core/models/note.model';
import { TranslationRef } from '@core/models/translation-ref.model';
import { ClockService } from '@core/time/clock.service';
import { expiryRef, isExpiringSoon, relativeTimeRef } from '@core/utils/relative-time.util';
import { LanguageBadgeComponent } from '@shared/ui/language-badge/language-badge.component';

/** Le libellé du pied de carte est soit du texte brut (nom de source), soit une référence de traduction (temps). */
type FooterLabel = { kind: 'text'; value: string } | { kind: 'ref'; ref: TranslationRef };

const SNIPPET_LINES = 3;
const MAX_VISIBLE_TAGS = 2;

@Component({
  selector: 'app-note-card',
  imports: [LanguageBadgeComponent, TranslocoPipe],
  templateUrl: './note-card.component.html',
  styleUrl: './note-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteCardComponent {
  private readonly clock = inject(ClockService);

  readonly note = input.required<Note>();
  readonly selected = input(false);

  readonly opened = output<string>();

  protected readonly snippet = computed(() =>
    this.note().content.split('\n').slice(0, SNIPPET_LINES).join('\n'),
  );

  protected readonly displayedTags = computed(() => this.note().tags.slice(0, MAX_VISIBLE_TAGS));

  protected readonly footerLabel = computed<FooterLabel>(() => {
    const note = this.note();
    if (note.lifecycle.kind === 'expires') {
      return { kind: 'ref', ref: expiryRef(note.lifecycle.at, this.clock.now()) };
    }
    // Une note épinglée affiche son contexte plutôt que son âge : elle est là
    // pour durer, savoir d'où elle vient est plus utile que sa date.
    if (note.pinned && note.source) {
      return { kind: 'text', value: note.source.split(' / ')[0] };
    }
    return { kind: 'ref', ref: relativeTimeRef(note.updatedAt, this.clock.now()) };
  });

  protected readonly footerStale = computed(() => {
    const note = this.note();
    return note.lifecycle.kind === 'expires' && isExpiringSoon(note.lifecycle.at, this.clock.now());
  });

  protected onOpen(): void {
    this.opened.emit(this.note().id);
  }
}
