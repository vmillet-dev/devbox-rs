import { Injectable } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { unwrap } from '@core/ipc/ipc.error';
import { ExportReport, ImportReport } from '../model/note.model';
import { toImportReport } from './note.dto';

/**
 * Import, export et partage. Le fichier est écrit et relu **côté Rust** : le
 * front ne fait que choisir un chemin, sans quoi il faudrait tenir un second
 * format de sérialisation en TypeScript.
 */
@Injectable({ providedIn: 'root' })
export class TransferRepository {
  /** `spaceId` à `null` exporte tout le corpus. */
  async export(path: string, spaceId: string | null): Promise<ExportReport> {
    return unwrap('export_notes', await commands.exportNotes(path, spaceId));
  }

  /** Même fichier, restreint aux notes désignées. */
  async exportSelection(path: string, ids: readonly string[]): Promise<ExportReport> {
    return unwrap('export_selection', await commands.exportSelection(path, [...ids]));
  }

  async import(path: string): Promise<ImportReport> {
    return toImportReport(unwrap('import_notes', await commands.importNotes(path)));
  }

  /** Rendu Markdown, que l'appelant pose dans le presse-papier. */
  async share(ids: readonly string[]): Promise<string> {
    return unwrap('share_notes', await commands.shareNotes([...ids]));
  }
}
