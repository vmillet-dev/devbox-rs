import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageTag } from '@notes/model/language.model';
import { LanguageBadgeComponent } from '@notes/ui/language-badge/language-badge.component';

/**
 * Twin of `TagRailComponent`: same union semantics, same scope to the active space. The
 * languages offered come from the back end and not from `LANGUAGE_LABELS` — offering a
 * facet that would filter nothing in the current space is noise.
 */
@Component({
  selector: 'app-language-rail',
  imports: [LanguageBadgeComponent, TranslocoPipe],
  templateUrl: './language-rail.component.html',
  styleUrl: './language-rail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageRailComponent {
  readonly languages = input.required<readonly LanguageTag[]>();
  readonly activeLanguages = input.required<ReadonlySet<LanguageTag>>();

  readonly languageToggled = output<LanguageTag>();
}
