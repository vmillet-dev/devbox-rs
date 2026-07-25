import { Injectable } from '@angular/core';

/**
 * Préférences locales de l'utilisateur (langue de l'UI, à terme thème…).
 *
 * Encapsule `localStorage` pour deux raisons : les accès sont doublables en
 * test sans bricoler l'objet global, et l'API du WebView peut lever
 * (mode privé, quota dépassé) — une préférence non enregistrée ne doit jamais
 * faire tomber l'application.
 *
 * TODO(backend) : migrer vers `tauri-plugin-store` une fois le plugin ajouté
 * côté Rust. Le stockage serait alors un vrai fichier sur disque, lisible
 * depuis Rust et insensible à un vidage du WebView. Seule cette classe
 * changerait ; il faudra aussi déclarer la permission du plugin dans
 * `src-tauri/capabilities/default.json`, sinon l'appel est refusé à l'exécution.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Préférence non persistée : sans gravité, la session reste utilisable.
    }
  }
}
