import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NotesStore } from '@core/stores/notes.store';
import { SpacesStore } from '@core/stores/spaces.store';
import { FilterChipsComponent } from '../components/filter-chips/filter-chips.component';
import { LanguageRailComponent } from '../components/language-rail/language-rail.component';
import { NoteEditorOverlayComponent } from '../components/note-editor-overlay/note-editor-overlay.component';
import { NoteSectionComponent } from '../components/note-section/note-section.component';
import { SearchBoxComponent } from '../components/search-box/search-box.component';
import {
  SpaceDeletion,
  SpaceRenaming,
  SpaceSwitcherComponent,
} from '../components/space-switcher/space-switcher.component';
import { TagRailComponent } from '../components/tag-rail/tag-rail.component';

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
