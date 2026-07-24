import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NoteSection } from '../../../../core/models/note.model';
import { NoteSectionComponent } from '../note-section/note-section.component';

@Component({
  selector: 'app-note-canvas',
  imports: [NoteSectionComponent],
  templateUrl: './note-canvas.component.html',
  styleUrl: './note-canvas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteCanvasComponent {
  readonly sections = input.required<NoteSection[]>();
  readonly selectedNoteId = input<string | null>(null);

  readonly noteOpened = output<string>();
  readonly createRequested = output<void>();
}
