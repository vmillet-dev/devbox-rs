import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Note } from '../../../../core/models/note.model';
import { formatExpiry, formatRelativeTime, isExpiringSoon } from '../../../../core/utils/relative-time.util';
import { LanguageBadgeComponent } from '../../../../shared/ui/language-badge/language-badge.component';

@Component({
  selector: 'app-note-card',
  imports: [LanguageBadgeComponent],
  templateUrl: './note-card.component.html',
  styleUrl: './note-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteCardComponent {
  readonly note = input.required<Note>();
  readonly selected = input(false);

  readonly opened = output<string>();

  protected readonly snippet = computed(() => this.note().content.split('\n').slice(0, 3).join('\n'));

  protected readonly displayedTags = computed(() => this.note().tags.slice(0, 2));

  protected readonly footerLabel = computed(() => {
    const note = this.note();
    if (note.lifecycle.kind === 'expires') {
      return formatExpiry(note.lifecycle.at);
    }
    return note.pinned ? note.source.split(' / ')[0] : formatRelativeTime(note.updatedAt);
  });

  protected readonly footerStale = computed(() => {
    const note = this.note();
    return note.lifecycle.kind === 'expires' && isExpiringSoon(note.lifecycle.at);
  });

  protected onOpen(): void {
    this.opened.emit(this.note().id);
  }
}
