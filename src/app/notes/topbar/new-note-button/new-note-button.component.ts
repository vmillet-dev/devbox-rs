import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NoteKind } from '@notes/model/note.model';
import { MenuPanelDirective } from '@shared/a11y/menu-panel.directive';
import { MenuTriggerDirective } from '@shared/a11y/menu-trigger.directive';

/**
 * A split button rather than a plain dropdown: the two gestures do not share a
 * frequency — creating a note stays the common case and keeps one click, picking a kind
 * takes two. There is deliberately no shared dropdown component: what factors out here
 * is the behaviour, not the presentation.
 */
@Component({
  selector: 'app-new-note-button',
  imports: [TranslocoPipe, MenuPanelDirective],
  hostDirectives: [MenuTriggerDirective],
  templateUrl: './new-note-button.component.html',
  styleUrl: './new-note-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewNoteButtonComponent {
  readonly created = output<NoteKind>();

  protected readonly menu = inject(MenuTriggerDirective);

  constructor() {
    // Only one level to fold here, unlike the space switcher.
    this.menu.escaped.subscribe(() => this.menu.close());
  }

  protected create(kind: NoteKind): void {
    this.created.emit(kind);
    this.menu.close();
  }
}
