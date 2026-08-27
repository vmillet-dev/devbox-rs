import { Injectable, computed, inject, signal } from '@angular/core';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { FileDialogService } from '@core/dialogs/file-dialog.service';
import { StatusNotifier } from '@core/notifications/status.service';
import { AttachmentsRepository } from '../data/attachments.repository';
import { Attachment } from '../model/note.model';

/**
 * Pièces jointes de la note ouverte.
 *
 * Les octets ne sont jamais chargés en masse : `preview` en demande **une** à la
 * fois, et un `data:` URI pèse un tiers de plus que le fichier — précharger la
 * liste ferait entrer plusieurs mégaoctets dans la WebView pour une vignette.
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
   * La pièce jointe dont l'aperçu est ouvert. Résolue ici et non dans le
   * bandeau : la vue agrandie vit dans la page, au-dessus de l'éditeur, et n'a
   * pas accès à ce que le bandeau a calculé pour lui-même.
   */
  readonly previewed = computed<Attachment | null>(() => {
    const id = this._previewId();
    return this._attachments().find((attachment) => attachment.id === id) ?? null;
  });

  /**
   * Appelé à chaque changement de note ouverte. Une note différente vide
   * l'aperçu : afficher la capture d'écran de la précédente serait pire que rien.
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

  /** `false` quand rien n'a été ajouté — annulation du sélecteur comprise. */
  async attach(): Promise<boolean> {
    const path = await this.dialog.pickAttachment();
    if (path === null) return false;

    return this.attachPath(path);
  }

  /**
   * Squelette des trois façons d'ajouter une pièce jointe. Le nom du fichier
   * ajouté est annoncé : sans retour, joindre une capture d'écran ne se voit
   * qu'en cherchant dans le bandeau.
   */
  private async write(action: (noteId: string) => Promise<Attachment>): Promise<boolean> {
    const noteId = this._noteId();
    if (noteId === null || this._isBusy()) return false;

    this._isBusy.set(true);
    try {
      const added = await action(noteId);
      await this.load(noteId);
      this.status.notify({ key: 'attachments.added', params: { name: added.fileName } });
      // Une image jointe s'affiche tout de suite : c'est ce qu'on veut voir.
      if (added.mimeType.startsWith('image/')) {
        await this.togglePreview(added.id);
      }
      return true;
    } catch (error) {
      this.notifier.reportFailure('errors.attachFailed', error);
      return false;
    } finally {
      this._isBusy.set(false);
    }
  }

  /**
   * Joint un fichier **déjà désigné** — celui qu'on vient de déposer sur
   * l'éditeur. Le sélecteur de fichiers n'est pas rouvert.
   */
  async attachPath(path: string): Promise<boolean> {
    return this.write((noteId) => this.repository.attach(noteId, path));
  }

  /**
   * Joint l'image du presse-papier. `Ctrl+V` dans l'éditeur passe par ici quand
   * le presse-papier ne contient pas de texte.
   */
  async attachClipboardImage(now: Date): Promise<boolean> {
    return this.write((noteId) => this.repository.attachClipboardImage(noteId, screenshotName(now)));
  }

  /** Ouvre la pièce jointe avec l'application par défaut du système. */
  async open(id: string): Promise<void> {
    try {
      await this.repository.open(id);
    } catch (error) {
      this.notifier.reportFailure('errors.attachmentOpenFailed', error);
    }
  }

  /** `null` quand rien n'a été enregistré — annulation du sélecteur comprise. */
  async saveAs(id: string): Promise<string | null> {
    const attachment = this._attachments().find((candidate) => candidate.id === id);
    if (!attachment) return null;

    const path = await this.dialog.chooseDestination(attachment.fileName);
    if (path === null) return null;

    try {
      await this.repository.saveAs(id, path);
      return path;
    } catch (error) {
      this.notifier.reportFailure('errors.attachmentSaveFailed', error);
      return null;
    }
  }

  async remove(id: string): Promise<boolean> {
    const noteId = this._noteId();
    if (noteId === null) return false;

    try {
      await this.repository.delete(id);
      if (this._previewId() === id) {
        this.closePreview();
      }
      await this.load(noteId);
      return true;
    } catch (error) {
      this.notifier.reportFailure('errors.attachmentDeleteFailed', error);
      return false;
    }
  }

  /** Bascule : redemander l'aperçu ouvert le referme, sans nouvel aller-retour. */
  async togglePreview(id: string): Promise<void> {
    if (this._previewId() === id) {
      this.closePreview();
      return;
    }

    this._previewId.set(id);
    this._previewData.set(null);
    try {
      const data = await this.repository.read(id);
      // La note a pu changer pendant la lecture : n'afficher que ce qui est
      // encore demandé.
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
    try {
      this._attachments.set(await this.repository.loadFor(noteId));
    } catch (error) {
      this.notifier.reportFailure('errors.attachFailed', error);
    }
  }
}

/**
 * Nom d'une image collée : daté à la seconde, pour que deux captures de suite ne
 * se ressemblent pas dans la liste. L'extension est ajoutée côté Rust.
 */
function screenshotName(now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `capture-${stamp}`;
}
