import { Injectable, computed, inject, signal } from '@angular/core';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { FileDialogService } from '@core/dialogs/file-dialog.service';
import { StatusNotifier } from '@core/notifications/status.service';
import { AttachmentsRepository } from '../data/attachments.repository';
import { Attachment } from '../model/note.model';

/**
 * The open note's attachments.
 *
 * ⚠️ The bytes are never loaded in bulk: `preview` asks for **one** at a time,
 * and a `data:` URI weighs a third more than the file — preloading the list
 * would pull several megabytes into the WebView for one thumbnail.
 */
@Injectable({ providedIn: 'root' })
export class AttachmentsStore {
  private readonly repository = inject(AttachmentsRepository);
  private readonly dialog = inject(FileDialogService);
  private readonly status = inject(StatusNotifier);
  private readonly notifier = inject(ErrorNotifier);

  private readonly _noteId = signal<string | null>(null);
  private readonly _attachments = signal<readonly Attachment[]>([]);
  private readonly _isBusy = signal(false);
  private readonly _previewId = signal<string | null>(null);
  private readonly _previewData = signal<string | null>(null);

  readonly attachments = this._attachments.asReadonly();
  readonly isBusy = this._isBusy.asReadonly();
  readonly previewId = this._previewId.asReadonly();
  readonly previewData = this._previewData.asReadonly();
  readonly count = computed(() => this._attachments().length);

  /**
   * The attachment whose preview is open. Resolved here and not in the strip:
   * the lightbox lives in the page, above the editor, and cannot see what the
   * strip computed for itself.
   */
  readonly previewed = computed<Attachment | null>(() => {
    const id = this._previewId();
    return this._attachments().find((attachment) => attachment.id === id) ?? null;
  });

  /**
   * Called whenever the open note changes. A different note clears the preview:
   * showing the previous one's screenshot would be worse than nothing.
   */
  async openFor(noteId: string | null): Promise<void> {
    if (this._noteId() === noteId) return;

    this._noteId.set(noteId);
    this.closePreview();
    this._attachments.set([]);
    if (noteId !== null) {
      await this.load(noteId);
    }
  }

  /** `false` when nothing was added — a cancelled picker included. */
  async attach(): Promise<boolean> {
    const path = await this.dialog.pickAttachment();
    if (path === null) return false;

    return this.attachPath(path);
  }

  /**
   * The shape shared by the three ways of adding an attachment. The file name
   * is announced: without it, attaching a screenshot is only visible by looking
   * for it in the strip.
   */
  private async write(action: (noteId: string) => Promise<Attachment>): Promise<boolean> {
    const noteId = this._noteId();
    if (noteId === null || this._isBusy()) return false;

    this._isBusy.set(true);
    let added;
    try {
      added = await action(noteId);
    } catch (error) {
      this.notifier.reportFailure('errors.attachFailed', error);
      return false;
    } finally {
      // Bracketing flag: see `TrashStore.load`.
      this._isBusy.set(false);
    }

    await this.load(noteId);
    this.status.notify({ key: 'attachments.added', params: { name: added.fileName } });
    // An attached image shows straight away: it is what one wants to see.
    if (added.mimeType.startsWith('image/')) {
      await this.togglePreview(added.id);
    }

    return true;
  }

  /**
   * Attaches an **already named** file — the one just dropped on the editor.
   * The file picker is not reopened.
   */
  async attachPath(path: string): Promise<boolean> {
    return this.write((noteId) => this.repository.attach(noteId, path));
  }

  /**
   * Attaches the clipboard image. `Ctrl+V` in the editor comes through here
   * when the clipboard holds no text.
   */
  async attachClipboardImage(now: Date): Promise<boolean> {
    return this.write((noteId) => this.repository.attachClipboardImage(noteId, screenshotName(now)));
  }

  /** Opens the attachment with the system's default application. */
  async open(id: string): Promise<void> {
    await this.notifier.attempt('errors.attachmentOpenFailed', () => this.repository.open(id));
  }

  /** `null` when nothing was saved — a cancelled picker included. */
  async saveAs(id: string): Promise<string | null> {
    const attachment = this._attachments().find((candidate) => candidate.id === id);
    if (!attachment) return null;

    const path = await this.dialog.chooseDestination(attachment.fileName);
    if (path === null) return null;

    const saved = await this.notifier.attempt('errors.attachmentSaveFailed', () =>
      this.repository.saveAs(id, path),
    );

    return saved === null ? null : path;
  }

  async remove(id: string): Promise<boolean> {
    const noteId = this._noteId();
    if (noteId === null) return false;

    const removed = await this.notifier.attempt('errors.attachmentDeleteFailed', () =>
      this.repository.delete(id),
    );
    if (removed === null) return false;

    if (this._previewId() === id) {
      this.closePreview();
    }
    await this.load(noteId);
    return true;
  }

  /** A toggle: asking again for the open preview closes it, with no round trip. */
  async togglePreview(id: string): Promise<void> {
    if (this._previewId() === id) {
      this.closePreview();
      return;
    }

    this._previewId.set(id);
    this._previewData.set(null);
    try {
      const data = await this.repository.read(id);
      // The note may have changed during the read: show only what is still asked for.
      if (this._previewId() === id) {
        this._previewData.set(data);
      }
    } catch (error) {
      this.closePreview();
      this.notifier.reportFailure('errors.attachmentReadFailed', error);
    }
  }

  closePreview(): void {
    this._previewId.set(null);
    this._previewData.set(null);
  }

  private async load(noteId: string): Promise<void> {
    const loaded = await this.notifier.attempt('errors.attachFailed', () => this.repository.loadFor(noteId));
    if (loaded) this._attachments.set(loaded);
  }
}

/**
 * The name of a pasted image: dated to the second, so two captures in a row do
 * not look alike in the list. The extension is added on the Rust side.
 */
function screenshotName(now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `capture-${stamp}`;
}
