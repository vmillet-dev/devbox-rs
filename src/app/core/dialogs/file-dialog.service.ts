import { InjectionToken, Injectable, inject } from '@angular/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { OpenDialogOptions, SaveDialogOptions } from '@tauri-apps/plugin-dialog';

/**
 * Ce que ce service attend du plugin. Un jeton plutôt qu'un appel direct, pour
 * la même raison pratique que `CLIPBOARD_ADAPTER` : le builder Angular regroupe
 * les modules avant que Vitest ne les voie, et `vi.mock` sur un paquet externe
 * n'intercepte alors qu'une fois sur deux.
 */
export interface FileDialogAdapter {
  open(options: OpenDialogOptions): Promise<string | string[] | null>;
  save(options: SaveDialogOptions): Promise<string | null>;
}

export const FILE_DIALOG_ADAPTER = new InjectionToken<FileDialogAdapter>('FILE_DIALOG_ADAPTER', {
  providedIn: 'root',
  factory: () => ({ open, save }),
});

/** Filtre du format d'échange, partagé par l'import et l'export. */
const BUNDLE_FILTER = { name: 'DevBox', extensions: ['json'] };

/**
 * Sélecteur de fichiers natif.
 *
 * `null` couvre aussi bien l'annulation que l'indisponibilité du plugin (hors
 * Tauri, il lève) : dans les deux cas l'appelant n'a rien à ouvrir, et une
 * exception l'obligerait à distinguer deux non-choix.
 */
@Injectable({ providedIn: 'root' })
export class FileDialogService {
  private readonly adapter = inject(FILE_DIALOG_ADAPTER);

  async pickBundle(): Promise<string | null> {
    return this.pick({ multiple: false, filters: [BUNDLE_FILTER] });
  }

  async pickAttachment(): Promise<string | null> {
    return this.pick({ multiple: false });
  }

  async chooseBundleDestination(defaultPath: string): Promise<string | null> {
    return this.destination({ defaultPath, filters: [BUNDLE_FILTER] });
  }

  /**
   * Sans filtre : une pièce jointe peut être de n'importe quel type, et en
   * imposer un renommerait le fichier que l'utilisateur veut récupérer tel quel.
   */
  async chooseDestination(defaultPath: string): Promise<string | null> {
    return this.destination({ defaultPath });
  }

  private async destination(options: SaveDialogOptions): Promise<string | null> {
    try {
      return await this.adapter.save(options);
    } catch {
      return null;
    }
  }

  /**
   * `multiple: false` est demandé au plugin, mais son type de retour reste une
   * union : le tableau est écarté ici pour que les appelants n'aient qu'un
   * chemin à traiter.
   */
  private async pick(options: OpenDialogOptions): Promise<string | null> {
    try {
      const chosen = await this.adapter.open(options);
      if (Array.isArray(chosen)) return chosen[0] ?? null;
      return chosen;
    } catch {
      return null;
    }
  }
}
