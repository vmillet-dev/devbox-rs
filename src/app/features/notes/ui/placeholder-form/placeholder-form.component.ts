import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DialogBackdropDirective } from '@shared/a11y/dialog-backdrop.directive';
import { FocusTrapDirective } from '@shared/a11y/focus-trap.directive';
import { Placeholder } from '@features/notes/model/note.model';

/**
 * Saisie des `{{champs}}` d'un snippet avant copie.
 *
 * Les valeurs partent brutes : c'est `notes::placeholder::fill`, côté Rust, qui
 * décide ce qu'un champ vide vaut (sa valeur par défaut) et ce qui n'est pas un
 * champ du tout. Refaire ce choix ici, c'est en avoir deux.
 *
 * « Copier tel quel » existe pour la note qui contient du template sans en être
 * un — le back est prudent, il n'est pas infaillible.
 */
@Component({
  selector: 'app-placeholder-form',
  imports: [DialogBackdropDirective, FocusTrapDirective, TranslocoPipe],
  templateUrl: './placeholder-form.component.html',
  styleUrl: './placeholder-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'cancelled.emit()',
  },
})
export class PlaceholderFormComponent {
  readonly placeholders = input.required<readonly Placeholder[]>();

  readonly submitted = output<Record<string, string>>();
  readonly rawRequested = output<void>();
  readonly cancelled = output<void>();

  /**
   * Amorcé par les valeurs par défaut : elles sont là pour être gardées, et un
   * champ vide obligerait à retaper `5432` à chaque copie.
   */
  private readonly values = signal<Record<string, string>>({});

  protected readonly count = computed(() => this.placeholders().length);

  protected valueOf(placeholder: Placeholder): string {
    return this.values()[placeholder.name] ?? placeholder.defaultValue;
  }

  protected setValue(name: string, value: string): void {
    this.values.update((current) => ({ ...current, [name]: value }));
  }

  protected submit(event: Event): void {
    event.preventDefault();

    const filled: Record<string, string> = {};
    for (const placeholder of this.placeholders()) {
      filled[placeholder.name] = this.valueOf(placeholder);
    }
    this.submitted.emit(filled);
  }
}
