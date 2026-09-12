import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FALLBACK_LANGUAGE, LanguageTag } from '@core/model/language.model';
import { highlightLines } from './highlighter';

/**
 * A read-only preview, coloured by language through highlight.js. In `shared/ui` because
 * it knows nothing of the notes.
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

  /** Numbering a three-line excerpt on a card teaches nothing. */
  readonly showLineNumbers = input(true);

  /** The embedded variant: no margin, no scrolling, no font size of its own. */
  readonly compact = input(false);

  protected readonly lines = computed<readonly string[]>(() =>
    highlightLines(this.content(), this.language()),
  );
}
