import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Note } from '@core/models/note.model';
import { TranslationRef } from '@core/models/translation-ref.model';
import { ClockService } from '@core/time/clock.service';
import { expiryRef, relativeTimeRef } from '@core/utils/relative-time.util';
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
}
