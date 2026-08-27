import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Attachment } from '@features/notes/model/note.model';

const BYTES_PER_KB = 1024;

/**
 * Bandeau des pièces jointes d'une note : ajouter, ouvrir, enregistrer ailleurs,
 * prévisualiser, retirer.
 *
 * Un fichier joint qu'on ne peut que lire de nom ne sert à rien : « ouvrir »
 * (application par défaut du système) et « enregistrer sous » sont ce qui le
 * rend récupérable.
 *
 * L'aperçu est demandé **à la volée** et une seule à la fois : un `data:` URI
 * pèse un tiers de plus que le fichier, en précharger la liste ferait entrer
 * plusieurs mégaoctets dans la WebView pour une vignette.
 */
@Component({
  selector: 'app-attachment-strip',
  imports: [TranslocoPipe],
  templateUrl: './attachment-strip.component.html',
  styleUrl: './attachment-strip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttachmentStripComponent {
  readonly attachments = input.required<readonly Attachment[]>();
  readonly isBusy = input(false);
  readonly previewId = input<string | null>(null);
  /** `null` tant que les octets n'ont pas été lus : l'aperçu affiche un vide. */
  readonly previewData = input<string | null>(null);

  readonly addRequested = output<void>();
  readonly openRequested = output<string>();
  readonly saveRequested = output<string>();
  readonly removeRequested = output<string>();
  readonly previewToggled = output<string>();
  /** L'aperçu est bordé en hauteur : la vue agrandie montre l'image entière. */
  readonly zoomRequested = output<void>();

  protected readonly confirmingRemove = signal<string | null>(null);

  /** Résolu ici pour que l'aperçu porte le **nom** du fichier, pas son identifiant. */
  protected readonly previewed = computed<Attachment | null>(() => {
    const id = this.previewId();
    return this.attachments().find((attachment) => attachment.id === id) ?? null;
  });

  protected isImage(attachment: Attachment): boolean {
    return attachment.mimeType.startsWith('image/');
  }

  /** Arrondi au Ko supérieur : « 0 Ko » pour un fichier non vide serait faux. */
  protected sizeInKb(attachment: Attachment): number {
    return Math.max(1, Math.ceil(attachment.byteSize / BYTES_PER_KB));
  }

  protected onRemoveClick(id: string): void {
    if (this.confirmingRemove() !== id) {
      this.confirmingRemove.set(id);
      return;
    }
    this.confirmingRemove.set(null);
    this.removeRequested.emit(id);
  }
}
