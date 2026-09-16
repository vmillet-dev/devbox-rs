import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Folder, FolderColour } from '@core/model/folder.model';
import { MenuPanelDirective } from '@shared/directives/menu-panel.directive';
import { MenuTriggerDirective } from '@shared/directives/menu-trigger.directive';

export interface FolderRenaming {
  readonly id: string;
  readonly name: string;
}

export interface FolderRecolouring {
  readonly id: string;
  readonly colour: FolderColour;
}

/** The palette the back end assigns from; the order is `FolderColour::ALL`. */
const COLOURS: readonly FolderColour[] = ['blue', 'amber', 'purple', 'green', 'red'];

/**
 * Narrows the canvas to one folder, and is where a folder is made and managed until the
 * board has a zone menu of its own.
 *
 * ⚠️ No "unfiled" entry: the absence of a chip already reads on a card, and a third
 * state here would be a second way to say the same thing.
 */
@Component({
  selector: 'app-folder-switcher',
  imports: [TranslocoPipe, MenuPanelDirective],
  hostDirectives: [MenuTriggerDirective],
  templateUrl: './folder-switcher.component.html',
  styleUrl: './folder-switcher.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderSwitcherComponent {
  readonly folders = input.required<readonly Folder[]>();
  /** `null` = every folder, filed or not. */
  readonly activeFolder = input.required<Folder | null>();
  /** No space means no board and nothing to file into: creation is refused, not hidden. */
  readonly canCreate = input(true);

  readonly folderChanged = output<string | null>();
  readonly folderCreated = output<string>();
  readonly folderRenamed = output<FolderRenaming>();
  readonly folderRecoloured = output<FolderRecolouring>();
  readonly folderDeleted = output<string>();

  protected readonly menu = inject(MenuTriggerDirective);
  protected readonly colours = COLOURS;

  protected readonly creating = signal(false);

  /** ⚠️ The panel replaces the menu: input fields inside a `role="menu"` are not valid ARIA. */
  protected readonly editing = signal<Folder | null>(null);

  /** Two steps: the WebView blocks on a native `confirm()`. */
  protected readonly confirmingDelete = signal(false);

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

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

  protected select(folder: Folder | null): void {
    this.folderChanged.emit(folder?.id ?? null);
    this.menu.close();
  }

  protected startCreating(): void {
    this.creating.set(true);
  }

  protected startEditing(folder: Folder): void {
    this.editing.set(folder);
    this.confirmingDelete.set(false);
  }

  /** `submit` and not `click`: the form then also answers Enter. */
  protected submitNewFolder(event: Event, name: string): void {
    event.preventDefault();
    if (!name.trim()) return;

    this.folderCreated.emit(name);
    this.menu.close();
  }

  protected submitRename(event: Event, name: string): void {
    event.preventDefault();
    const edited = this.editing();
    if (!edited || !name.trim()) return;

    this.folderRenamed.emit({ id: edited.id, name });
    this.menu.close();
  }

  protected pickColour(colour: FolderColour): void {
    const edited = this.editing();
    if (!edited || edited.colour === colour) return;

    this.folderRecoloured.emit({ id: edited.id, colour });
  }

  /** ⚠️ No refuge to choose, unlike a space: the notes come out loose. */
  protected onDeleteClick(): void {
    const edited = this.editing();
    if (!edited) return;

    if (!this.confirmingDelete()) {
      this.confirmingDelete.set(true);
      return;
    }
    this.folderDeleted.emit(edited.id);
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
