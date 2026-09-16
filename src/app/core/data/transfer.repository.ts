import { Injectable } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { unwrap } from '@core/ipc/ipc.error';
import { ExportReport, ImportReport } from '../model/note.model';

/** The file is written and read back on the Rust side; the front only picks a path. */
@Injectable({ providedIn: 'root' })
export class TransferRepository {
  /**
   * A `null` `spaceId` exports the whole corpus. ⚠️ A `null` `passphrase` writes the file
   * in the clear — the library's own key protects what is on this machine, never what
   * leaves it.
   */
  async export(path: string, spaceId: string | null, passphrase: string | null): Promise<ExportReport> {
    return unwrap('export_notes', await commands.exportNotes(path, spaceId, passphrase));
  }

  async exportSelection(
    path: string,
    ids: readonly string[],
    passphrase: string | null,
  ): Promise<ExportReport> {
    return unwrap('export_selection', await commands.exportSelection(path, [...ids], passphrase));
  }

  async import(path: string, passphrase: string | null): Promise<ImportReport> {
    return unwrap('import_notes', await commands.importNotes(path, passphrase));
  }

  /** Asked before the import, so the phrase can be requested rather than demanded twice. */
  async isProtected(path: string): Promise<boolean> {
    return unwrap('export_is_protected', await commands.exportIsProtected(path));
  }

  async share(ids: readonly string[]): Promise<string> {
    return unwrap('share_notes', await commands.shareNotes([...ids]));
  }
}
