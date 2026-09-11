import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DialogBackdropDirective } from '@shared/a11y/dialog-backdrop.directive';
import { FocusTrapDirective } from '@shared/a11y/focus-trap.directive';
import { Placeholder } from '@features/notes/model/note.model';
import {
  PlaceholderFieldsComponent,
  PlaceholderValue,
} from '../placeholder-fields/placeholder-fields.component';

/**
 * Saisie des `{{champs}}` d'un snippet avant copie, depuis une carte ou la
 * palette — là où il n'y a pas d'éditeur ouvert pour porter le panneau.
 *
 * Amorcée par les valeurs **déjà enregistrées** sur la note : il n'y a qu'un jeu
 * de valeurs par note, et le formulaire les propose plutôt que de reposer la
 * question. Ce qui en sort est copié *et* gardé.
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
  imports: [DialogBackdropDirective, FocusTrapDirective, PlaceholderFieldsComponent, TranslocoPipe],
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
   * Saisie en cours. `null` tant que rien n'a été tapé : la note fournit alors
   * ses propres valeurs, et les recopier ici les figerait le jour où le
   * formulaire s'ouvre sur une note dont les valeurs ont changé entre-temps.
   */
  private readonly typed = signal<Record<string, string> | null>(null);

  protected readonly count = computed(() => this.placeholders().length);

  protected readonly values = computed(
    () =>
      this.typed() ??
      Object.fromEntries(this.placeholders().map((placeholder) => [placeholder.name, placeholder.value])),
  );

  protected setValue({ name, value }: PlaceholderValue): void {
    this.typed.set({ ...this.values(), [name]: value });
  }

  protected submit(event: Event): void {
    event.preventDefault();

    const filled: Record<string, string> = {};
    for (const placeholder of this.placeholders()) {
      filled[placeholder.name] = this.values()[placeholder.name] ?? '';
    }
    this.submitted.emit(filled);
  }
}
