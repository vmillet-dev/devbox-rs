import { EnvironmentProviders, inject, provideAppInitializer } from '@angular/core';
import { UpdateStore } from './update.store';

/**
 * Lance la recherche de mise à jour au démarrage.
 *
 * La promesse est volontairement **non retournée** : Angular attend celles que
 * lui rend un initialiseur, et l'application resterait sur un écran vide le
 * temps d'un appel réseau — plusieurs secondes derrière un DNS lent, indéfiniment
 * si l'endpoint ne répond pas. La pop-in apparaît quand la réponse arrive.
 */
export function provideUpdateCheck(): EnvironmentProviders {
  return provideAppInitializer(() => {
    void inject(UpdateStore).check();
  });
}
