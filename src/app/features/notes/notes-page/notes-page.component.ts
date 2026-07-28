import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LanguageTag } from '@core/models/language.model';
import { NoteLifecycle } from '@core/models/note.model';
import { NotesStore } from '@core/stores/notes.store';
import { SpacesStore } from '@core/stores/spaces.store';
import { SpaceDeletion, SpaceRenaming } from '../components/space-switcher/space-switcher.component';
import { LanguageRailComponent } from '../components/language-rail/language-rail.component';
import { NoteCanvasComponent } from '../components/note-canvas/note-canvas.component';
import { NoteEditorOverlayComponent } from '../components/note-editor-overlay/note-editor-overlay.component';
import { NotesTopbarComponent } from '../components/notes-topbar/notes-topbar.component';
import { TagRailComponent } from '../components/tag-rail/tag-rail.component';

@Component({
  selector: 'app-notes-page',
  imports: [
    NotesTopbarComponent,
    TagRailComponent,
    LanguageRailComponent,
    NoteCanvasComponent,
    NoteEditorOverlayComponent,
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

  protected onTitleChanged(title: string): void {
    this.withSelectedNote((id) => this.store.renameNote(id, title));
  }

  protected onContentChanged(content: string): void {
    this.withSelectedNote((id) => this.store.updateContent(id, content));
  }

  protected onLanguageChanged(language: LanguageTag): void {
    this.withSelectedNote((id) => this.store.setLanguage(id, language));
  }

  protected onTagAdded(tag: string): void {
    this.withSelectedNote((id) => this.store.addTag(id, tag));
  }

  protected onTagRemoved(tag: string): void {
    this.withSelectedNote((id) => this.store.removeTag(id, tag));
  }

  protected onPinToggled(): void {
    this.withSelectedNote((id) => this.store.togglePinned(id));
  }

  protected onLifecycleChanged(lifecycle: NoteLifecycle): void {
    this.withSelectedNote((id) => this.store.setLifecycle(id, lifecycle));
  }

  protected onDeleteRequested(): void {
    this.withSelectedNote((id) => this.store.deleteNote(id));
  }

  /**
   * L'éditeur n'émet jamais l'identifiant de la note qu'il affiche : c'est le
   * store qui décide de la note ouverte, et le lui faire renvoyer ouvrirait la
   * porte à une modification appliquée à une note qui n'est plus la bonne.
   */
  private withSelectedNote(action: (id: string) => Promise<void>): void {
    const id = this.store.selectedNoteId();
    if (id) {
      void action(id);
    }
  }
}
