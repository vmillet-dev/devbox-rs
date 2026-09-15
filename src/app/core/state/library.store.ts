import { Injectable, inject, signal } from '@angular/core';
import { ClipboardService } from '@core/services/clipboard/clipboard.service';
import { ErrorNotifier } from '@core/services/errors/error-notifier.service';
import { FileDialogService } from '@core/services/dialogs/file-dialog.service';
import { StatusNotifier } from '@core/services/notifications/status.service';
import { ImportReport } from '@core/model/note.model';
import { TransferRepository } from '../data/transfer.repository';
import { NotesRevision } from './notes-revision';

/** Dated, so two exports do not overlap. */
function defaultFileName(now: Date): string {
  return `devbox-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Export then re-import at once adds nothing at all, and saying so explicitly stops it
 * looking like a breakdown. A note degraded from a newer version arrived all the same,
 * and the report is the only place that says so.
 */
function importedKey(report: ImportReport): string {
  if (report.notesImported === 0) return 'file.importedNothing';

  return report.notesDegraded > 0 ? 'file.importedFromNewerVersion' : 'file.imported';
}

function fileNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/**
 * Every operation reports, including when it changed nothing. Reports go under the
 * titlebar: the menu closes on the click, and a native dialog would cover it.
 */
@Injectable({ providedIn: 'root' })
export class LibraryStore {
  private readonly repository = inject(TransferRepository);
  private readonly dialog = inject(FileDialogService);
  private readonly clipboard = inject(ClipboardService);
  private readonly status = inject(StatusNotifier);
  private readonly notifier = inject(ErrorNotifier);
  private readonly revision = inject(NotesRevision);

  private readonly _isBusy = signal(false);

  readonly isBusy = this._isBusy.asReadonly();

  /** `true` when notes came in, which is what bumps the canvas revision. */
  async import(): Promise<boolean> {
    const path = await this.dialog.pickBundle();
    if (path === null) return false;

    return this.run(async () => {
      const report = await this.repository.import(path);
      const params = {
        notes: String(report.notesImported),
        skipped: String(report.notesSkipped),
        degraded: String(report.notesDegraded),
        path: fileNameOf(path),
      };

      this.status.notify({ key: importedKey(report), params });

      const changed = report.notesImported > 0 || report.spacesCreated > 0;
      if (changed) this.revision.bump();

      return changed;
    }, 'errors.importFailed');
  }

  /** A `null` `spaceId` exports the whole corpus. */
  async export(spaceId: string | null, now: Date): Promise<void> {
    await this.write((path) => this.repository.export(path, spaceId), now);
  }

  async exportSelection(ids: readonly string[], now: Date): Promise<void> {
    if (!this.requireSelection(ids)) return;

    await this.write((path) => this.repository.exportSelection(path, ids), now);
  }

  /** Sharing stops at the clipboard: nothing is sent anywhere. */
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

      // The file name is part of the report: an export whose landing place is unknown
      // is no use.
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
