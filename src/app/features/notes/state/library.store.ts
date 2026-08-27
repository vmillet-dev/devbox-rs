import { Injectable, inject, signal } from '@angular/core';
import { ClipboardService } from '@core/clipboard/clipboard.service';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { FileDialogService } from '@core/dialogs/file-dialog.service';
import { StatusNotifier } from '@core/notifications/status.service';
import { TransferRepository } from '../data/transfer.repository';

/** Nom proposé au sélecteur : daté, pour que deux exports ne se recouvrent pas. */
function defaultFileName(now: Date): string {
  return `devbox-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Le chemin complet est long et sans intérêt dans un bandeau ; le nom du fichier
 * suffit à reconnaître ce qu'on vient d'écrire ou de lire.
 */
function fileNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/**
 * Import, export et partage — ce que le menu « Fichier » déclenche.
 *
 * **Chaque opération rend compte**, y compris quand elle n'a rien changé : un
 * import qui n'ajoute rien parce que tout est déjà là et un import qui échoue se
 * ressemblent trop à l'écran pour rester silencieux. Le compte rendu passe par
 * `StatusNotifier`, sous la barre de titre — le menu, lui, se referme.
 */
@Injectable({ providedIn: 'root' })
export class LibraryStore {
  private readonly repository = inject(TransferRepository);
  private readonly dialog = inject(FileDialogService);
  private readonly clipboard = inject(ClipboardService);
  private readonly status = inject(StatusNotifier);
  private readonly notifier = inject(ErrorNotifier);

  private readonly _isBusy = signal(false);

  readonly isBusy = this._isBusy.asReadonly();

  /** `true` quand des notes sont entrées : la page recharge alors le canevas. */
  async import(): Promise<boolean> {
    const path = await this.dialog.pickBundle();
    if (path === null) return false;

    return this.run(async () => {
      const report = await this.repository.import(path);
      const params = {
        notes: String(report.notesImported),
        skipped: String(report.notesSkipped),
        path: fileNameOf(path),
      };

      // Le geste le plus courant — exporter puis réimporter aussitôt — n'ajoute
      // rien du tout. Le dire explicitement évite de croire à une panne.
      this.status.notify({
        key: report.notesImported === 0 ? 'file.importedNothing' : 'file.imported',
        params,
      });

      return report.notesImported > 0 || report.spacesCreated > 0;
    }, 'errors.importFailed');
  }

  /** `spaceId` à `null` exporte tout le corpus. */
  async export(spaceId: string | null, now: Date): Promise<void> {
    await this.write((path) => this.repository.export(path, spaceId), now);
  }

  async exportSelection(ids: readonly string[], now: Date): Promise<void> {
    if (!this.requireSelection(ids)) return;

    await this.write((path) => this.repository.exportSelection(path, ids), now);
  }

  /**
   * Le partage s'arrête au presse-papier : rien n'est envoyé nulle part, ce qui
   * est aussi la raison pour laquelle il n'y a rien à confirmer. Le libellé du
   * menu annonce le format, faute de quoi le Markdown est une surprise.
   */
  async copyAsMarkdown(ids: readonly string[]): Promise<void> {
    if (!this.requireSelection(ids)) return;

    await this.run(async () => {
      const markdown = await this.repository.share(ids);
      if (!(await this.clipboard.copy(markdown))) {
        this.notifier.notify({ ref: { key: 'errors.copyFailed' } });
        return false;
      }

      this.status.notify({ key: 'file.copied', params: { notes: String(ids.length) } });
      return true;
    }, 'errors.shareFailed');
  }

  private requireSelection(ids: readonly string[]): boolean {
    if (ids.length > 0) return true;

    this.notifier.notify({ ref: { key: 'file.needsSelection' } });
    return false;
  }

  private async write(action: (path: string) => Promise<{ notes: number }>, now: Date): Promise<void> {
    const path = await this.dialog.chooseBundleDestination(defaultFileName(now));
    if (path === null) return;

    await this.run(async () => {
      const report = await action(path);

      if (report.notes === 0) {
        this.status.notify({ key: 'file.emptyLibrary' });
        return false;
      }

      // Le nom du fichier fait partie du compte rendu : un export réussi dont on
      // ne sait pas où il a atterri ne sert à rien.
      this.status.notify({
        key: 'file.exported',
        params: { notes: String(report.notes), path: fileNameOf(path) },
      });
      return true;
    }, 'errors.exportFailed');
  }

  private async run(action: () => Promise<boolean>, failureKey: string): Promise<boolean> {
    this._isBusy.set(true);
    try {
      return await action();
    } catch (error) {
      this.notifier.reportFailure(failureKey, error);
      return false;
    } finally {
      this._isBusy.set(false);
    }
  }
}
