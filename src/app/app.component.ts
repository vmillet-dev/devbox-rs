import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  /** Lié au champ de saisie via [(ngModel)] */
  nom = '';

  /** Dernière réponse renvoyée par la commande Rust `saluer` */
  reponse = '';

  /** Message d'erreur si l'appel invoke() échoue */
  erreur = '';

  /** Évite les doubles soumissions pendant l'appel IPC */
  chargement = false;

  /**
   * Appelle la commande Rust `saluer` (définie dans
   * src-tauri/src/commands/greetings.rs) via le pont IPC de Tauri.
   */
  async saluer(): Promise<void> {
    if (!this.nom.trim()) {
      return;
    }

    this.chargement = true;
    this.erreur = '';

    try {
      // La clé "nom" doit correspondre exactement au paramètre
      // de la fonction Rust : fn saluer(nom: String) -> String
      this.reponse = await invoke<string>('saluer', { nom: this.nom });
    } catch (err) {
      this.erreur = `Erreur côté Rust : ${err}`;
    } finally {
      this.chargement = false;
    }
  }
}
