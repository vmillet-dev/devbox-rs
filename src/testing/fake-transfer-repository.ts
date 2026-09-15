import { guard } from './fail-next';
import { TransferRepository } from '@core/data/transfer.repository';
import { ExportReport, ImportReport } from '@core/model/note.model';

/** Records the arguments and hands back the report the spec asked for. */
export class FakeTransferRepository implements Pick<TransferRepository, keyof TransferRepository> {
  /** When set, the next call to any method rejects with this error, then clears. */
  failNext: Error | null = null;

  exportedTo: { path: string; spaceId: string | null } | null = null;
  importedFrom: string | null = null;
  sharedIds: readonly string[] | null = null;
  exportedIds: readonly string[] | null = null;

  exportReport: ExportReport = { notes: 3, spaces: 1 };
  importReport: ImportReport = {
    spacesCreated: 1,
    notesImported: 2,
    notesSkipped: 0,
    notesDegraded: 0,
  };
  markdown = '## Shared\n\n```txt\nbody\n```\n';

  export(path: string, spaceId: string | null): Promise<ExportReport> {
    return guard(this, () => {
      this.exportedTo = { path, spaceId };
      return this.exportReport;
    });
  }

  exportSelection(path: string, ids: readonly string[]): Promise<ExportReport> {
    return guard(this, () => {
      this.exportedTo = { path, spaceId: null };
      this.exportedIds = ids;
      return { ...this.exportReport, notes: ids.length };
    });
  }

  import(path: string): Promise<ImportReport> {
    return guard(this, () => {
      this.importedFrom = path;
      return this.importReport;
    });
  }

  share(ids: readonly string[]): Promise<string> {
    return guard(this, () => {
      this.sharedIds = ids;
      return this.markdown;
    });
  }
}
