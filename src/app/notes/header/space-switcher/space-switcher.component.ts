import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Space } from '@core/model/space.model';
import { MenuPanelDirective } from '@shared/directives/menu-panel.directive';
import { MenuTriggerDirective } from '@shared/directives/menu-trigger.directive';

export interface SpaceDeletion {
  readonly id: string;
  /** The space that takes in the deleted one's notes. */
  readonly targetSpaceId: string;
}

export interface SpaceRenaming {
  readonly id: string;
  readonly name: string;
}

@Component({
  selector: 'app-space-switcher',
  imports: [TranslocoPipe, MenuPanelDirective],
  hostDirectives: [MenuTriggerDirective],
  templateUrl: './space-switcher.component.html',
  styleUrl: './space-switcher.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpaceSwitcherComponent {
  readonly spaces = input.required<readonly Space[]>();
  /** `null` = "all spaces", a choice in its own right and not a waiting state. */
  readonly activeSpace = input.required<Space | null>();

  readonly spaceChanged = output<string | null>();
  readonly spaceCreated = output<string>();
  readonly spaceRenamed = output<SpaceRenaming>();
  readonly pinRequested = output<string>();
  readonly spaceDeleted = output<SpaceDeletion>();

  protected readonly menu = inject(MenuTriggerDirective);

  protected readonly creating = signal(false);

  /** ⚠️ The panel replaces the menu: input fields inside a `role="menu"` are not valid ARIA. */
  protected readonly editing = signal<Space | null>(null);

  /** Two steps: the WebView blocks on a native `confirm()`. */
  protected readonly confirmingDelete = signal(false);

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

  /** A space cannot be its own refuge: the cascade would take the notes after the transfer. */
  protected readonly moveTargets = computed<readonly Space[]>(() => {
    const edited = this.editing();
    return edited ? this.spaces().filter((space) => space.id !== edited.id) : [];
  });

  constructor() {
    this.menu.escaped.subscribe(() => this.onEscape());
    this.menu.closed.subscribe(() => this.resetPanels());

    effect(() => {
      if (!this.menu.open()) return;
      if (this.editing()) {
        this.renameInput()?.nativeElement.focus();
      } else if (this.creating()) {
        this.nameInput()?.nativeElement.focus();
      }
    });
  }

  protected toggle(): void {
    this.menu.toggle();
    this.resetPanels();
  }

  protected select(space: Space | null): void {
    this.spaceChanged.emit(space?.id ?? null);
    this.menu.close();
  }

  protected startCreating(): void {
    this.creating.set(true);
  }

  protected startEditing(space: Space): void {
    this.editing.set(space);
    this.confirmingDelete.set(false);
  }

  /** `submit` and not `click`: the form then also answers Enter. */
  protected submitNewSpace(event: Event, name: string): void {
    event.preventDefault();
    if (!name.trim()) return;

    this.spaceCreated.emit(name);
    this.menu.close();
  }

  protected submitRename(event: Event, name: string): void {
    event.preventDefault();
    const edited = this.editing();
    if (!edited || !name.trim()) return;

    this.spaceRenamed.emit({ id: edited.id, name });
    this.menu.close();
  }

  protected onDeleteClick(targetSpaceId: string): void {
    const edited = this.editing();
    if (!edited || !targetSpaceId) return;

    if (!this.confirmingDelete()) {
      this.confirmingDelete.set(true);
      return;
    }
    this.spaceDeleted.emit({ id: edited.id, targetSpaceId });
    this.menu.close();
  }

  /** Escape closes the open panel first, then the menu itself. */
  private onEscape(): void {
    if (this.editing() || this.creating()) {
      this.resetPanels();
      return;
    }
    this.menu.close();
  }

  private resetPanels(): void {
    this.creating.set(false);
    this.editing.set(null);
    this.confirmingDelete.set(false);
  }
}
