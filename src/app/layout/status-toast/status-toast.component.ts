import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { StatusNotifier } from '@core/notifications/status.service';

/**
 * Accusé de réception d'une action réussie, sous la barre de titre.
 *
 * Au même endroit que le bandeau d'erreur, et pour la même raison : un import
 * qui n'ajoute rien, un export qui écrit un fichier ailleurs — sans retour à
 * l'écran, l'application a l'air de n'avoir rien fait.
 */
@Component({
  selector: 'app-status-toast',
  imports: [TranslocoPipe],
  templateUrl: './status-toast.component.html',
  styleUrl: './status-toast.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusToastComponent {
  protected readonly notifier = inject(StatusNotifier);
}
