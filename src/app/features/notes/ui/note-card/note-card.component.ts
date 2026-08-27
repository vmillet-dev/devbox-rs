import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Note } from '@features/notes/model/note.model';
import { Space } from '@features/notes/model/space.model';
import { TranslationRef } from '@core/i18n/translation-ref.model';
import { ClockService } from '@core/time/clock.service';
import { expiryRef, relativeTimeRef } from '@core/time/relative-time.util';
import { CodeViewerComponent } from '@shared/ui/code-viewer/code-viewer.component';
import { LanguageBadgeComponent } from '@shared/ui/language-badge/language-badge.component';
import { CopyButtonComponent } from '../copy-button/copy-button.component';
import { NoteCardMenuComponent } from '../note-card-menu/note-card-menu.component';

/** Le libellé du pied de carte est soit du texte brut (nom de source), soit une référence de traduction (temps). */
type FooterLabel = { kind: 'text'; value: string } | { kind: 'ref'; ref: TranslationRef };

/** Déplacement demandé depuis le menu d'une carte. */
export interface NoteMove {
  readonly noteId: string;
  readonly spaceId: string;
}

/** Ouverture demandée, et comment : le modificateur décide de la sélection. */
export interface NoteActivation {
  readonly noteId: string;
  readonly toggleChecked: boolean;
  readonly extendRange: boolean;
}

const SNIPPET_LINES = 3;
const MAX_VISIBLE_TAGS = 2;

@Component({
  selector: 'app-note-card',
  imports: [
    CodeViewerComponent,
    CopyButtonComponent,
    LanguageBadgeComponent,
    NoteCardMenuComponent,
    TranslocoPipe,
  ],
  templateUrl: './note-card.component.html',
  styleUrl: './note-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteCardComponent {
  private readonly clock = inject(ClockService);

  readonly note = input.required<Note>();
  /** La note ouverte dans l'éditeur. */
  readonly selected = input(false);
  /** La note que la navigation clavier désigne — distincte de la sélection. */
  readonly focused = input(false);
  readonly checked = input(false);
  /** Destinations proposées par le menu ; l'espace de la note en est retiré. */
  readonly spaces = input<readonly Space[]>([]);

  readonly opened = output<NoteActivation>();
  readonly checkToggled = output<string>();
  readonly moveRequested = output<NoteMove>();
  readonly deleteRequested = output<string>();
  /** La note porte des `{{champs}}` : la page ouvre le formulaire de saisie. */
  readonly fillRequested = output<string>();

  private readonly cardButton = viewChild.required<ElementRef<HTMLButtonElement>>('cardButton');

  constructor() {
    // Le focus réel suit l'état, sans quoi la navigation aux flèches
    // déplacerait un contour sans emmener le clavier avec lui.
    effect(() => {
      if (this.focused() && document.activeElement !== this.cardButton().nativeElement) {
        this.cardButton().nativeElement.focus({ preventScroll: false });
      }
    });
  }

  protected readonly snippet = computed(() =>
    this.note().content.split('\n').slice(0, SNIPPET_LINES).join('\n'),
  );

  protected readonly displayedTags = computed(() => this.note().tags.slice(0, MAX_VISIBLE_TAGS));

  protected readonly hasPlaceholders = computed(() => this.note().placeholders.length > 0);

  /**
   * Le back a déjà tranché **quoi** afficher ; il ne reste qu'à le rendre. Les
   * deux variantes datées sont formatées ici pour que le libellé vieillisse à
   * l'écran, sans nouvelle requête.
   */
  protected readonly footerLabel = computed<FooterLabel>(() => {
    const footer = this.note().footer;
    if (footer.kind === 'source') {
      return { kind: 'text', value: footer.value };
    }
    if (footer.kind === 'expiry') {
      return { kind: 'ref', ref: expiryRef(footer.at, this.clock.now()) };
    }
    return { kind: 'ref', ref: relativeTimeRef(footer.at, this.clock.now()) };
  });

  /**
   * Ctrl coche, Maj étend la plage, un clic nu ouvre — la convention d'une liste
   * de fichiers, qui est ce que le canevas est devenu avec la sélection.
   */
  protected onOpen(event: MouseEvent): void {
    this.opened.emit({
      noteId: this.note().id,
      toggleChecked: event.ctrlKey || event.metaKey,
      extendRange: event.shiftKey,
    });
  }

  /** La case à cocher est un contrôle à part : elle ne doit pas ouvrir la note. */
  protected onCheck(event: MouseEvent): void {
    event.stopPropagation();
    this.checkToggled.emit(this.note().id);
  }

  protected onFill(event: MouseEvent): void {
    event.stopPropagation();
    this.fillRequested.emit(this.note().id);
  }

  /** Le menu ne connaît pas la note : c'est la carte qui rattache l'identifiant. */
  protected onMove(spaceId: string): void {
    this.moveRequested.emit({ noteId: this.note().id, spaceId });
  }

  protected onDelete(): void {
    this.deleteRequested.emit(this.note().id);
  }
}
