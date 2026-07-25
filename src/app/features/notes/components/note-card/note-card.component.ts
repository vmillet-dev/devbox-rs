import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Note } from '../../../../core/models/note.model';
import { TranslationRef, expiryRef, isExpiringSoon, relativeTimeRef } from '../../../../core/utils/relative-time.util';
import { LanguageBadgeComponent } from '../../../../shared/ui/language-badge/language-badge.component';

/** Le libellé du pied de carte est soit du texte brut (nom de source), soit une référence de traduction (temps). */
type FooterLabel = { kind: 'text'; value: string } | { kind: 'ref'; ref: TranslationRef };

@Component({
  selector: 'app-note-card',
  imports: [LanguageBadgeComponent, TranslocoPipe],
  templateUrl: './note-card.component.html',
  styleUrl: './note-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteCardComponent {
  readonly note = input.required<Note>();
  readonly selected = input(false);

  readonly opened = output<string>();

  protected readonly snippet = computed(() => this.note().content.split('\n').slice(0, 3).join('\n'));

  protected readonly displayedTags = computed(() => this.note().tags.slice(0, 2));

  protected readonly footerLabel = computed<FooterLabel>(() => {
    const note = this.note();
    if (note.lifecycle.kind === 'expires') {
      return { kind: 'ref', ref: expiryRef(note.lifecycle.at) };
    }
    if (note.pinned) {
      return { kind: 'text', value: note.source.split(' / ')[0] };
    }
    return { kind: 'ref', ref: relativeTimeRef(note.updatedAt) };
  });

  protected readonly footerStale = computed(() => {
    const note = this.note();
    return note.lifecycle.kind === 'expires' && isExpiringSoon(note.lifecycle.at);
  });

  protected onOpen(): void {
    this.opened.emit(this.note().id);
  }
}
