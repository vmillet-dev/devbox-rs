import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NoteSection } from '@core/model/note.model';
import { NotesStore } from '@core/state/notes.store';
import { NoteActivation, NoteCardComponent } from '../note-card/note-card.component';

@Component({
  selector: 'app-note-section',
  imports: [NoteCardComponent, TranslocoPipe],
  templateUrl: './note-section.component.html',
  styleUrl: './note-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteSectionComponent {
  private readonly notes = inject(NotesStore);

  readonly section = input.required<NoteSection>();

  readonly noteActivated = output<NoteActivation>();

  /** The section key is the translation key: no label kept in two places. */
  protected readonly titleKey = computed(() => `sections.${this.section().key}`);

  /** Ties the region to its heading, for screen-reader region navigation. */
  protected readonly headingId = computed(() => `section-heading-${this.section().key}`);

  protected createNote(): void {
    this.notes.createNote();
  }
}
