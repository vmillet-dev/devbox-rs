import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TranslationRef } from '@core/models/translation-ref.model';
import { UpdateStore } from '@core/updates/update.store';
import { AboutDialogComponent } from '@shared/ui/about-dialog/about-dialog.component';

/**
 * Menu « À propos » de la barre de titre, à la façon d'une barre de menus.
 *
 * Deux entrées : lancer une recherche de mise à jour, et ouvrir la fiche
 * d'information. La première rend compte sur place — c'est tout l'intérêt d'une
 * recherche manuelle par rapport à celle du démarrage, silencieuse par choix.
 *
 * Le motif d'ouverture, de focus et de navigation aux flèches est celui de
 * `SpaceSwitcherComponent` ; il est repris plutôt que réinventé pour que les
 * deux menus de l'application se comportent pareil au clavier.
 */
@Component({
  selector: 'app-about-menu',
  imports: [TranslocoPipe, AboutDialogComponent],
  templateUrl: './about-menu.component.html',
  styleUrl: './about-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(keydown.escape)': 'onEscape()',
  },
})
export class AboutMenuComponent {
  protected readonly store = inject(UpdateStore);

  protected readonly open = signal(false);
  protected readonly dialogOpen = signal(false);

  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly options = viewChildren<ElementRef<HTMLButtonElement>>('option');

  protected readonly checking = computed(() => this.store.checkState() === 'checking');

  /** `null` quand le menu n'a rien à annoncer — voir `CheckState`. */
  protected readonly checkStatusRef = computed<TranslationRef | null>(() => {
    switch (this.store.checkState()) {
      case 'checking':
        return { key: 'about.checking' };
      case 'upToDate':
        return { key: 'about.upToDate' };
      case 'failed':
        return { key: 'about.checkFailed' };
      default:
        return null;
    }
  });

  constructor() {
    // Ouvrir un menu sans y amener le focus le rend inatteignable au clavier.
    // La requête de vue n'est pas à jour à l'instant où `open` bascule : l'effet
    // dépend aussi d'`options()`, il se rejoue donc dès qu'elle l'est.
    effect(() => {
      if (this.open()) {
        this.options()[0]?.nativeElement.focus();
      }
    });
  }

  protected toggle(): void {
    this.open.update((value) => !value);
  }

  protected checkUpdates(): void {
    if (this.checking()) return;
    void this.store.checkNow();
  }

  protected openDialog(): void {
    this.dialogOpen.set(true);
    this.closeAndRestoreFocus({ restoreFocus: false });
  }

  /**
   * Le piège à focus de la modale rendrait la main à l'élément actif au moment
   * de son ouverture — l'entrée de menu, détruite depuis. Le focus repart donc
   * explicitement sur le déclencheur, seul point de repère encore à l'écran.
   */
  protected closeDialog(): void {
    this.dialogOpen.set(false);
    this.trigger().nativeElement.focus();
  }

  protected onEscape(): void {
    this.closeAndRestoreFocus();
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.elementRef.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    const items = this.options().map((ref) => ref.nativeElement);
    if (items.length === 0) return;

    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (index: number): void => {
      event.preventDefault();
      items[(index + items.length) % items.length].focus();
    };

    switch (event.key) {
      case 'ArrowDown':
        focusAt(currentIndex + 1);
        break;
      case 'ArrowUp':
        focusAt(currentIndex - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(items.length - 1);
        break;
    }
  }

  private closeAndRestoreFocus({ restoreFocus = true } = {}): void {
    if (!this.open()) return;
    this.open.set(false);
    // Sans ça, le focus disparaît avec l'élément détruit et repart sur <body>.
    if (restoreFocus) this.trigger().nativeElement.focus();
  }
}
