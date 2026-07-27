import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageTag } from '@core/models/language.model';
import { LanguageBadgeComponent } from '@shared/ui/language-badge/language-badge.component';

/**
 * Rail de facettes « Format », jumeau de `TagRailComponent` : même sémantique
 * d'union (une note passe si elle est écrite dans **l'un** des langages
 * sélectionnés), même portée à l'espace actif.
 *
 * Les langages proposés viennent du backend et non de `LANGUAGE_LABELS` :
 * proposer une facette qui ne filtrerait rien dans l'espace courant serait du
 * bruit.
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
