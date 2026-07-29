import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ClipboardService } from '@core/clipboard/clipboard.service';

/** Durée de l'accusé de copie : assez pour être vu, assez court pour ne pas suivre la souris sur la carte suivante. */
const FEEDBACK_MS = 2000;

/**
 * Copie une valeur dans le presse-papier et le fait savoir.
 *
 * Dans `features/` et non dans `shared/` : il injecte, et un composant de
 * `shared/` n'injecte rien.
 */
@Component({
  selector: 'app-copy-button',
  imports: [TranslocoPipe],
  templateUrl: './copy-button.component.html',
  styleUrl: './copy-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopyButtonComponent {
  private readonly clipboard = inject(ClipboardService);

  readonly value = input.required<string>();
  /** Ajoute le libellé à côté de l'icône, pour une barre d'outils. */
  readonly showLabel = input(false);

  protected readonly copied = signal(false);

  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimeout());
  }

  /**
   * `stopPropagation` parce que la carte hôte est elle-même un bouton
   * d'ouverture : sans lui, copier ouvrirait l'éditeur dans la foulée.
   */
  protected async onCopy(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    if (!(await this.clipboard.copy(this.value()))) return;

    this.copied.set(true);
    this.clearTimeout();
    this.timeout = setTimeout(() => {
      this.timeout = null;
      this.copied.set(false);
    }, FEEDBACK_MS);
  }

  private clearTimeout(): void {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}
