import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Space } from '@features/notes/model/space.model';
import { MenuPanelDirective } from '@shared/a11y/menu-panel.directive';
import { MenuTriggerDirective } from '@shared/a11y/menu-trigger.directive';

/**
 * Separate from `NoteCardComponent` because it brings what the card has not: an
 * open/closed state and focus handling. It **never emits the note id** — it does not
 * know it, and the card adds it when relaying.
 */
@Component({
  selector: 'app-note-card-menu',
  imports: [TranslocoPipe, MenuPanelDirective],
  hostDirectives: [MenuTriggerDirective],
  templateUrl: './note-card-menu.component.html',
  styleUrl: './note-card-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteCardMenuComponent {
  /** An already displayable title: the card resolved the placeholder label. */
  readonly noteTitle = input.required<string>();
  readonly spaces = input.required<readonly Space[]>();
  readonly currentSpaceId = input.required<string>();

  readonly moveRequested = output<string>();
  readonly deleteRequested = output<void>();

  protected readonly menu = inject(MenuTriggerDirective);

  constructor() {
    this.menu.escaped.subscribe(() => this.menu.close());
  }

  /**
   * Deletion in two steps: the WebView blocks everything during a native `confirm()`.
   * Reset on every opening and closing.
   */
  protected readonly confirmingDelete = linkedSignal({
    source: this.menu.open,
    computation: () => false,
  });

  /** Moving a note where it already is makes no sense. */
  protected readonly moveTargets = computed<readonly Space[]>(() =>
    this.spaces().filter((space) => space.id !== this.currentSpaceId()),
  );

  protected toggle(event: MouseEvent): void {
    // The whole card is an opening button: without this, a click on the ⋯ would bubble
    // up and open the editor along with the menu.
    event.stopPropagation();
    this.menu.toggle();
  }

  protected move(spaceId: string): void {
    this.moveRequested.emit(spaceId);
    this.menu.close();
  }

  protected onDeleteClick(): void {
    if (!this.confirmingDelete()) {
      this.confirmingDelete.set(true);
      return;
    }
    this.deleteRequested.emit();
    this.menu.close();
  }
}
