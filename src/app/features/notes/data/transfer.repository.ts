import { Injectable } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { unwrap } from '@core/ipc/ipc.error';
import { ExportReport, ImportReport } from '../model/note.model';

/**
 * The file is written and read back **on the Rust side**: the front end only picks a
 * path, or there would be a second serialisation format to keep in TypeScript.
 */
@Injectable({ providedIn: 'root' })
export class TransferRepository {
  /** A `null` `spaceId` exports the whole corpus. */
  async export(path: string, spaceId: string | null): Promise<ExportReport> {
    return unwrap('export_notes', await commands.exportNotes(path, spaceId));
  }

  async exportSelection(path: string, ids: readonly string[]): Promise<ExportReport> {
    return unwrap('export_selection', await commands.exportSelection(path, [...ids]));
  }

  async import(path: string): Promise<ImportReport> {
    return unwrap('import_notes', await commands.importNotes(path));
  }

  async share(ids: readonly string[]): Promise<string> {
    return unwrap('share_notes', await commands.shareNotes([...ids]));
  }
}
