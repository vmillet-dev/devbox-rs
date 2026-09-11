import { LanguageTag } from '@core/language/language.model';
import { ChecklistItem, NoteKind } from './checklist.model';

export { type ChecklistItem, type NoteKind } from './checklist.model';

export type NoteLifecycle = { readonly kind: 'permanent' } | { readonly kind: 'expires'; readonly at: Date };

/**
 * La variante est choisie par le back : « une note épinglée montre son contexte
 * plutôt que son âge » est une règle produit. Deux variantes portent une date et
 * non un libellé, pour que le texte vieillisse sans aller-retour IPC.
 */
export type NoteFooter =
  | { readonly kind: 'source'; readonly value: string }
  | { readonly kind: 'expiry'; readonly at: Date }
  | { readonly kind: 'age'; readonly at: Date };

/** Immuable : toute modification produit un nouvel objet (voir `NotesStore`). */
export interface Note {
  readonly id: string;
  /** Jamais vide : une note vit forcément dans un espace. */
  readonly spaceId: string;
  /** Peut être vide (note tout juste créée) : l'UI affiche `notes.untitled`. */
  readonly title: string;
  readonly language: LanguageTag;
  readonly content: string;
  /** Contexte, ex. "API Gateway / Auth" — son premier segment sert de libellé. */
  readonly source: string;
  readonly tags: readonly string[];
  readonly pinned: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lifecycle: NoteLifecycle;
  /** Dérivé par le back, jamais écrit. */
  readonly footer: NoteFooter;
  /** Échéance proche. Seuil unique, tenu par le back. */
  readonly expiringSoon: boolean;
  /** Champs `{{…}}` repérés dans le contenu. Dérivé, jamais écrit. */
  readonly placeholders: readonly Placeholder[];
  /** Dérivé aussi : la carte n'en affiche qu'un compteur. */
  readonly attachmentCount: number;
  /** Ce que la note est. Une note écrite avant les todolists relit `snippet`. */
  readonly kind: NoteKind;
  /** Vide pour un snippet. Une todolist a ceci **à la place** de `content`. */
  readonly items: readonly ChecklistItem[];
}

/**
 * `id` et les horodatages sont attribués par la persistance ; `footer` et
 * `expiringSoon` sont dérivés — les envoyer laisserait croire que le front décide.
 */
export type NoteDraft = Omit<
  Note,
  'id' | 'createdAt' | 'updatedAt' | 'footer' | 'expiringSoon' | 'placeholders' | 'attachmentCount'
>;

export type NotePatch = Partial<NoteDraft>;

/**
 * `untriaged` = notes portant une date d'expiration : une note éphémère est
 * précisément celle dont on n'a pas encore décidé du sort.
 */
export type NoteFilter = 'all' | 'pinned' | 'untriaged';

/** Envoyé tel quel à `query_notes` : le front décrit son intention. */
export interface NotesQuery {
  /** `null` = « tous les espaces », un choix et non une absence de choix. */
  readonly spaceId: string | null;
  readonly search: string;
  readonly filter: NoteFilter;
  readonly tags: readonly string[];
  /** Même sémantique d'union que `tags` : au moins l'un d'eux. Vide = tous. */
  readonly languages: readonly LanguageTag[];
  /** Instant de référence, lu via `ClockService` pour rester testable. */
  readonly now: Date;
  /**
   * `Date#getTimezoneOffset()`. Les sections raisonnent en jours **locaux** :
   * sans ce décalage, une note créée à 23 h tomberait dans la mauvaise section.
   */
  readonly tzOffsetMinutes: number;
  /**
   * Remonte les notes épinglées en tête : leur section à elles quand la vue est
   * chronologique, le haut de la liste quand elle est plate. Le canevas dit
   * toujours `true`, la palette de collage rapide suit la préférence.
   */
  readonly pinnedFirst: boolean;
}

/**
 * Ce que le canevas affiche. Pas de liste plate ici : elle inviterait à
 * refiltrer ou re-trier ce que le backend a déjà fait.
 */
export interface NotesView {
  readonly sections: readonly NoteSection[];
  /** Tags du rail, portés à l'espace actif et non au filtre courant. */
  readonly availableTags: readonly string[];
  readonly availableLanguages: readonly LanguageTag[];
  /** Une recherche ou une sélection de facettes est active. */
  readonly isFiltering: boolean;
  readonly matched: number;
}

/**
 * `pinned` / `today` / `week` / `older` regroupent chronologiquement ;
 * `results` est la liste plate d'une recherche, où grouper par date masquerait
 * des résultats pertinents. La clé sert aussi de clé de traduction
 * (`'sections.' + key`).
 */
export type NoteSectionKey = 'pinned' | 'today' | 'week' | 'older' | 'results';

export interface NoteSection {
  readonly key: NoteSectionKey;
  readonly notes: readonly Note[];
  /** Au moins une note expire : le template en dérive `sections.expiringHint`. */
  readonly hasExpiringNotes: boolean;
  /** Affiche la carte fantôme « coller ou créer » en fin de section. */
  readonly showCreateGhost: boolean;
}

/**
 * Champ `{{nom}}` d'un snippet, éventuellement muni d'une valeur par défaut
 * (`{{port=5432}}`). Repéré par le back, qui décide seul de ce qui en est un.
 *
 * Pas de carte des valeurs à côté : la liste des champs vient du texte, les
 * valeurs viennent de la base, et le back les réunit ici — une valeur dont le
 * jeton a disparu du contenu n'est pas un champ, elle attend qu'il revienne.
 */
export interface Placeholder {
  readonly name: string;
  readonly defaultValue: string;
  /** Vide tant que rien n'a été saisi : le back lit alors `defaultValue`. */
  readonly value: string;
}

/**
 * Note en corbeille. Volontairement **pas** un `Note` : rien n'y est décoré
 * (pied de carte, échéance, champs `{{…}}`), parce qu'une note au rebut n'est
 * ni ouverte ni copiée — elle est restaurée ou purgée.
 *
 * `purgeAt` est dérivée : la rétention peut changer d'une version à l'autre, une
 * échéance figée en base ne suivrait pas.
 */
export interface TrashedNote {
  readonly id: string;
  readonly spaceId: string;
  readonly title: string;
  readonly language: LanguageTag;
  readonly content: string;
  readonly tags: readonly string[];
  readonly deletedAt: Date;
  readonly purgeAt: Date;
  /**
   * Une todolist n'a pas de `content` : le panneau affiche un libellé plutôt
   * qu'un aperçu vide. Les items, eux, ne descendent pas jusqu'ici — une note
   * au rebut n'est ni ouverte ni cochée.
   */
  readonly kind: NoteKind;
}

/** Un tag du corpus et le nombre de notes vivantes qui le portent. */
export interface TagUsage {
  readonly tag: string;
  readonly noteCount: number;
}

/**
 * Fiche d'une pièce jointe. Les octets n'y sont pas : ils arrivent à la demande,
 * en `data:` URI, par `AttachmentsRepository.read`.
 */
export interface Attachment {
  readonly id: string;
  readonly noteId: string;
  /** Nom d'origine, affiché tel quel. Jamais utilisé comme chemin. */
  readonly fileName: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly createdAt: Date;
}

export interface ExportReport {
  readonly notes: number;
  readonly spaces: number;
}

/** `notesSkipped` : déjà présentes, ou sans espace où atterrir. */
export interface ImportReport {
  readonly spacesCreated: number;
  readonly notesImported: number;
  readonly notesSkipped: number;
}
