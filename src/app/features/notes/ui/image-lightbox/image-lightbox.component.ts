import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DialogBackdropDirective } from '@shared/a11y/dialog-backdrop.directive';
import { FocusTrapDirective } from '@shared/a11y/focus-trap.directive';

/**
 * Une image de pièce jointe en grand, par-dessus tout le reste.
 *
 * Le bandeau borne son aperçu à 220 px pour ne pas pousser l'éditeur hors de
 * l'écran ; une capture de code y est illisible. Cette vue-ci ne borne que sur
 * la fenêtre.
 *
 * Elle ne relit rien : les octets sont ceux que l'aperçu a déjà chargés, et un
 * `data:` URI de plusieurs mégaoctets n'a pas à traverser le pont deux fois.
 */
@Component({
  selector: 'app-image-lightbox',
  imports: [DialogBackdropDirective, FocusTrapDirective, TranslocoPipe],
  templateUrl: './image-lightbox.component.html',
  styleUrl: './image-lightbox.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class ImageLightboxComponent {
  /** `data:` URI déjà en mémoire : le CSP interdit un chemin de fichier. */
  readonly source = input.required<string>();
  readonly fileName = input.required<string>();

  readonly closed = output<void>();
}
