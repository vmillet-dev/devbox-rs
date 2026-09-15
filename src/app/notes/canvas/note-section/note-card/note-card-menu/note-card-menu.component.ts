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
import { Space } from '@core/model/space.model';
import { MenuPanelDirective } from '@shared/directives/menu-panel.directive';
import { MenuTriggerDirective } from '@shared/directives/menu-trigger.directive';

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

  /** Two steps: the WebView blocks everything during a native `confirm()`. */
  protected readonly confirmingDelete = linkedSignal({
    source: this.menu.open,
    computation: () => false,
  });

  protected readonly moveTargets = computed<readonly Space[]>(() =>
    this.spaces().filter((space) => space.id !== this.currentSpaceId()),
  );

  protected toggle(event: MouseEvent): void {
    // The whole card is an opening button: without this, a click on the ⋯ bubbles up
    // and opens the editor along with the menu.
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
