import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NoteSection } from '../../../../core/models/note.model';
import { NoteCardComponent } from '../note-card/note-card.component';

@Component({
  selector: 'app-note-section',
  imports: [NoteCardComponent],
  templateUrl: './note-section.component.html',
  styleUrl: './note-section.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteSectionComponent {
  readonly section = input.required<NoteSection>();
  readonly selectedNoteId = input<string | null>(null);

  readonly noteOpened = output<string>();
  readonly createRequested = output<void>();
}
