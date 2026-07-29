import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FALLBACK_LANGUAGE, LanguageTag } from '@core/language/language.model';
import { highlightLines } from './highlighter';

/**
 * Aperçu en lecture seule, colorié selon le langage par highlight.js
 * (cf. `highlighter.ts`).
 *
 * Vit dans `shared/ui` parce qu'il ne sait rien des notes : la future feature
 * « formatters » (`format_json`) l'utilisera telle quelle.
 */
@Component({
  selector: 'app-code-viewer',
  templateUrl: './code-viewer.component.html',
  styleUrl: './code-viewer.component.scss',
  host: { '[class.compact]': 'compact()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeViewerComponent {
  readonly content = input.required<string>();
  readonly language = input<LanguageTag>(FALLBACK_LANGUAGE);

  /** Numéroter un extrait de trois lignes dans une carte n'apprend rien. */
  readonly showLineNumbers = input(true);

  /**
   * Variante intégrée : ni marge, ni défilement, ni taille de police propre —
   * le visualiseur adopte la typographie de son hôte (l'extrait d'une carte).
   */
  readonly compact = input(false);

  protected readonly lines = computed<readonly string[]>(() =>
    highlightLines(this.content(), this.language()),
  );
}
