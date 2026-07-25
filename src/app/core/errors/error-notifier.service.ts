import { Injectable, Signal, signal } from '@angular/core';
import { TranslationRef } from '../models/translation-ref.model';

/** Message d'erreur destiné à l'utilisateur, exprimé en clé de traduction. */
export interface AppNotice {
  readonly ref: TranslationRef;
  /** Détail technique brut (message d'erreur), affiché en second plan. */
  readonly detail?: string;
}

/**
 * Canal de remontée des erreurs vers l'interface.
 *
 * Sur une app de bureau, l'utilisateur n'ouvre pas la console : une écriture
 * qui échoue ou une exception non rattrapée doit être visible à l'écran, sans
 * quoi l'app paraît simplement « ne rien faire ». Une seule erreur est
 * conservée — la plus récente — pour éviter d'empiler des bannières.
 */
@Injectable({ providedIn: 'root' })
export class ErrorNotifier {
  private readonly _notice = signal<AppNotice | null>(null);

  readonly notice: Signal<AppNotice | null> = this._notice.asReadonly();

  notify(notice: AppNotice): void {
    this._notice.set(notice);
  }

  dismiss(): void {
    this._notice.set(null);
  }
}
