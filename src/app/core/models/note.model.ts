import { LanguageTag } from './language.model';

export type NoteLifecycle = { kind: 'permanent' } | { kind: 'expires'; at: Date };

export interface Note {
  readonly id: string;
  title: string;
  language: LanguageTag;
  content: string;
  /** Chemin de contexte, ex. "API Gateway / Auth" — le premier segment sert de libellé compact sur la carte. */
  source: string;
  tags: string[];
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  lifecycle: NoteLifecycle;
}

export type NoteSectionKey = 'pinned' | 'today' | 'week';

export interface NoteSection {
  key: NoteSectionKey;
  /** Clé de traduction Transloco (voir `src/assets/i18n/*.json`), traduite via le pipe `transloco` dans le template — pas le texte affiché. */
  title: string;
  /** Idem : clé de traduction, optionnelle. */
  hint?: string;
  notes: Note[];
  showCreateGhost?: boolean;
}
