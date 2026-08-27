import { Injectable } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { unwrap } from '@core/ipc/ipc.error';
import { Attachment } from '../model/note.model';
import { toAttachment } from './note.dto';

/**
 * Point d'accès aux pièces jointes. Les octets ne sont lus qu'à la demande :
 * `read` renvoie un `data:` URI, seule forme qu'un `<img>` accepte sous le CSP
 * de la WebView, mais qui pèse un tiers de plus que le fichier — une vignette se
 * demande à l'ouverture d'une note, jamais pour toute une liste.
 */
@Injectable({ providedIn: 'root' })
export class AttachmentsRepository {
  async loadFor(noteId: string): Promise<readonly Attachment[]> {
    return unwrap('list_attachments', await commands.listAttachments(noteId)).map(toAttachment);
  }

  /** `path` vient du sélecteur de fichiers natif ; la copie est faite côté Rust. */
  async attach(noteId: string, path: string): Promise<Attachment> {
    return toAttachment(unwrap('attach_file', await commands.attachFile(noteId, path)));
  }

  async read(id: string): Promise<string> {
    return unwrap('read_attachment', await commands.readAttachment(id));
  }

  /** Ouvre le fichier avec l'application par défaut du système. */
  async open(id: string): Promise<void> {
    unwrap('open_attachment', await commands.openAttachment(id));
  }

  /** Recopie le fichier là où l'utilisateur l'a demandé. */
  async saveAs(id: string, path: string): Promise<void> {
    unwrap('save_attachment', await commands.saveAttachment(id, path));
  }

  /**
   * Joint l'image du presse-papier. Les octets ne montent pas jusqu'ici : le
   * natif lit le presse-papier, encode en PNG et écrit le fichier lui-même.
   */
  async attachClipboardImage(noteId: string, fileName: string): Promise<Attachment> {
    return toAttachment(
      unwrap('attach_clipboard_image', await commands.attachClipboardImage(noteId, fileName)),
    );
  }

  async delete(id: string): Promise<void> {
    unwrap('delete_attachment', await commands.deleteAttachment(id));
  }
}
