import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppEventsService } from '@core/ipc/app-events.service';
import { NotesStore } from './state/notes.store';
import { SpacesStore } from './state/spaces.store';
import { FilterChipsComponent } from './ui/filter-chips/filter-chips.component';
import { LanguageRailComponent } from './ui/language-rail/language-rail.component';
import { NoteEditorOverlayComponent } from './ui/note-editor-overlay/note-editor-overlay.component';
import { NoteSectionComponent } from './ui/note-section/note-section.component';
import { SearchBoxComponent } from './ui/search-box/search-box.component';
import {
  SpaceDeletion,
  SpaceRenaming,
  SpaceSwitcherComponent,
} from './ui/space-switcher/space-switcher.component';
import { TagRailComponent } from './ui/tag-rail/tag-rail.component';

/**
 * Seule page de la feature : elle branche les deux stores sur les composants
 * d'affichage. Les enfants restent purement dérivés de leurs entrées.
 */
@Component({
  selector: 'app-notes-page',
  imports: [
    SpaceSwitcherComponent,
    SearchBoxComponent,
    FilterChipsComponent,
    TagRailComponent,
    LanguageRailComponent,
    NoteSectionComponent,
    NoteEditorOverlayComponent,
    TranslocoPipe,
  ],
  templateUrl: './notes-page.component.html',
  styleUrl: './notes-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotesPageComponent {
  protected readonly store = inject(NotesStore);
  protected readonly spaces = inject(SpacesStore);

  /** Le raccourci de recherche est neutralisé tant que la modale est ouverte. */
  protected readonly searchShortcutEnabled = computed(() => this.store.selectedNote() === null);

  /**
   * Les raccourcis globaux sont enregistrés côté Rust, qui se contente de
   * montrer la fenêtre et de prévenir : la création reste ici, et passe donc par
   * le même `create_note` que n'importe quelle autre note.
   */
  constructor() {
    const events = inject(AppEventsService);
    const destroyRef = inject(DestroyRef);

    destroyRef.onDestroy(events.on('devbox:capture', () => void this.store.captureFromClipboard()));
    destroyRef.onDestroy(events.on('devbox:new-note', () => void this.store.createNote()));
  }

  protected onSpaceRenamed({ id, name }: SpaceRenaming): void {
    // Rien à recharger : une note ne porte que le `spaceId`, jamais le nom.
    void this.spaces.renameSpace(id, name);
  }

  /**
   * `SpacesStore` ne connaît pas `NotesStore` — l'injecter serait un cycle. Le
   * rechargement est donc enchaîné ici : les notes de l'espace supprimé ont
   * changé de `spaceId` côté base, et rien ne le signalerait autrement quand la
   * requête courante ne dépend pas de l'espace disparu.
   */
  protected async onSpaceDeleted({ id, targetSpaceId }: SpaceDeletion): Promise<void> {
    if (await this.spaces.deleteSpace(id, targetSpaceId)) {
      this.store.reload();
    }
  }
}
